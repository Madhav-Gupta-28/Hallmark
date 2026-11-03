/**
 * Surviving MyNearWallet's redirect, and reading what actually happened.
 *
 * MyNearWallet signs on its own site and comes back to the callback URL with
 * `?transactionHashes=h1,h2` (or `?errorCode=…&errorMessage=…`); the promise
 * that asked for the signature is gone with the page. So before handing off,
 * the page records what it asked for in sessionStorage, and on return it
 * matches the hashes in the URL to that record and reads each transaction's
 * final outcome from the chain. Meteor signs in place and goes through the
 * same outcome reading, so there is one success path, not two.
 *
 * A signed transaction is not a successful open: ft_transfer_call succeeds
 * even when the vault refuses the terms, because the token simply refunds.
 * The only reliable signal is the outcome — the amount the vault kept, and
 * the vault's own `mandate_opened` event.
 */
import { rpc, VAULT, type MandateTerms, type Tx } from "./hallmark";

const KEY = "hallmark:pending-sign";

export interface Pending {
  kind: "open";
  signer: string;
  txs: Tx[];
  terms: MandateTerms;
  amount: string;
  at: number;
}

export function savePending(p: Pending): void {
  sessionStorage.setItem(KEY, JSON.stringify(p));
}
export function loadPending(): Pending | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; }
}
export function clearPending(): void {
  sessionStorage.removeItem(KEY);
}

export type Callback =
  | { kind: "signed"; hashes: string[] }
  | { kind: "error"; code: string; message: string };

/** What MyNearWallet put in the URL, if anything. */
export function readCallback(search: string): Callback | null {
  const q = new URLSearchParams(search);
  const hashes = q.get("transactionHashes");
  if (hashes) return { kind: "signed", hashes: hashes.split(",").filter(Boolean) };
  const code = q.get("errorCode");
  if (code) return { kind: "error", code, message: q.get("errorMessage") ?? "" };
  return null;
}

/** The URL with the wallet's result removed, so a reload does not replay it. */
export function withoutCallback(href: string): string {
  const u = new URL(href);
  for (const k of ["transactionHashes", "errorCode", "errorMessage"]) u.searchParams.delete(k);
  return u.pathname + (u.search === "?" ? "" : u.search) + u.hash;
}

/* --------------------------------------------------------------- outcomes */

type ExecStatus = { SuccessValue?: string; Failure?: unknown; SuccessReceiptId?: string } | string;

export interface ExecutionOutcome {
  status: ExecStatus;
  transaction: { hash: string; receiver_id: string; actions: Array<{ FunctionCall?: { method_name: string } }> };
  receipts_outcome: Array<{ id: string; outcome: { executor_id: string; logs: string[]; status: ExecStatus } }>;
}

/**
 * Final outcome of a transaction, waiting for finality.
 *
 * Each attempt is capped at 15 s and fails over to the next endpoint: a node
 * that does not (yet) know the hash holds a `wait_until` request open instead
 * of answering. `rpc` already cycles every endpoint twice; one outer retry
 * covers a transaction that has not propagated anywhere yet.
 */
export async function txOutcome(hash: string, sender: string): Promise<ExecutionOutcome> {
  const ask = () => rpc({ tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" }, "tx", "tx", 15_000);
  try {
    return await ask();
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
    return ask();
  }
}

const b64json = (s: string): unknown => {
  try { return JSON.parse(atob(s)); } catch { return undefined; }
};

/** The panic message, if this status is a contract panic. */
function panicOf(status: ExecStatus): string | null {
  if (typeof status !== "object" || !status.Failure) return null;
  const text = JSON.stringify(status.Failure);
  const m = /"ExecutionError":"((?:[^"\\]|\\.)*)"/.exec(text);
  return m ? JSON.parse(`"${m[1]}"`) : text;
}

export type Interpreted =
  | { kind: "storage_deposit"; ok: true; credited: string }
  | { kind: "open"; ok: true; mandateId: number; escrowed: string }
  | { kind: "open"; ok: false; reason: string }
  | { kind: "other"; ok: boolean; reason?: string };

/** What a Hallmark transaction did, read from its outcome rather than assumed. */
export function interpret(o: ExecutionOutcome): Interpreted {
  const method = o.transaction.actions[0]?.FunctionCall?.method_name;
  const top = panicOf(o.status);

  if (method === "storage_deposit" && o.transaction.receiver_id === VAULT) {
    if (top) return { kind: "other", ok: false, reason: top };
    const v = typeof o.status === "object" && o.status.SuccessValue ? b64json(o.status.SuccessValue) : undefined;
    return { kind: "storage_deposit", ok: true, credited: String(v ?? "") };
  }

  if (method === "ft_transfer_call") {
    if (top) return { kind: "open", ok: false, reason: top };
    // The vault's own receipt: a panic there is the refusal, with its reason.
    for (const r of o.receipts_outcome) {
      if (r.outcome.executor_id !== VAULT) continue;
      const p = panicOf(r.outcome.status);
      if (p) return { kind: "open", ok: false, reason: p };
      for (const log of r.outcome.logs) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        const ev = JSON.parse(log.slice("EVENT_JSON:".length));
        if (ev.standard === "hallmark" && ev.event === "mandate_opened") {
          const d = ev.data?.[0] ?? {};
          return { kind: "open", ok: true, mandateId: Number(d.mandate_id), escrowed: String(d.escrow) };
        }
      }
    }
    return { kind: "open", ok: false, reason: "the vault did not report opening a mandate" };
  }

  return top ? { kind: "other", ok: false, reason: top } : { kind: "other", ok: true };
}
