/**
 * Surviving a wallet's redirect, and reading what actually happened.
 *
 * A redirect wallet signs on its own site and comes back to the callback URL with
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
import { rpc, VAULT, type Tx } from "./hallmark";

const KEY = "hallmark:pending-sign";

/** What was handed to the wallet: enough to read the outcome on return. */
export interface Pending {
  /** a short label for what was asked, e.g. "open", "withdraw" */
  kind: string;
  signer: string;
  txs: Tx[];
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

/** What the wallet put in the URL on its way back, if anything. */
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
  transaction: {
    hash: string;
    receiver_id: string;
    /** `args` is base64 JSON, as the RPC returns it */
    actions: Array<{ FunctionCall?: { method_name: string; args?: string } }>;
  };
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
  | { kind: "fund"; ok: true; mandateId: number; added: string }
  | { kind: "fund"; ok: false; reason: string }
  | { kind: "withdraw" | "storage_withdraw"; ok: true }
  | { kind: "withdraw" | "storage_withdraw"; ok: false; reason: string }
  | { kind: "cancel"; ok: true; mandateId: number }
  | { kind: "reap"; ok: true; refunded: string }
  | { kind: "other"; ok: boolean; reason?: string };

const successValue = (st: ExecStatus): unknown =>
  typeof st === "object" && st.SuccessValue !== undefined ? (st.SuccessValue === "" ? null : b64json(st.SuccessValue)) : undefined;

/** The vault's own receipts: a panic there is a refusal, with the contract's reason. */
function vaultPanic(o: ExecutionOutcome): string | null {
  for (const r of o.receipts_outcome) {
    if (r.outcome.executor_id !== VAULT) continue;
    const p = panicOf(r.outcome.status);
    if (p) return p;
  }
  return null;
}

function vaultEvent(o: ExecutionOutcome, name: string): Record<string, unknown> | null {
  for (const r of o.receipts_outcome) {
    if (r.outcome.executor_id !== VAULT) continue;
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const ev = JSON.parse(log.slice("EVENT_JSON:".length));
        if (ev.standard === "hallmark" && ev.event === name) return ev.data?.[0] ?? {};
      } catch { /* not ours */ }
    }
  }
  return null;
}

/**
 * What a Hallmark transaction did, read from its outcome rather than assumed.
 * Each action has its own honest success signal:
 *   - open: the vault's `mandate_opened` event;
 *   - fund: no event exists, so the vault receipt must not panic AND the token
 *     must report the whole amount used (a refusal is refunded, used = 0);
 *   - withdraw / storage_withdraw: the resolve callback's bool — `false` means
 *     the payout failed and the vault restored the balance;
 *   - cancel: no panic (the `mandate_closed` event confirms it);
 *   - reap: the refunded storage it returns.
 */
export function interpret(o: ExecutionOutcome): Interpreted {
  const call = o.transaction.actions[0]?.FunctionCall;
  const method = call?.method_name;
  const args = (call?.args ? b64json(call.args) : undefined) as Record<string, unknown> | undefined;
  const top = panicOf(o.status);
  const toVault = o.transaction.receiver_id === VAULT;

  if (method === "ft_transfer_call") {
    let msg: Record<string, unknown> = {};
    try { msg = JSON.parse(String(args?.msg ?? "{}")); } catch { /* not ours */ }
    const action = msg.action ?? "open";           // older outcomes without args: the only kind posted before
    const refusal = top ?? vaultPanic(o);

    if (action === "fund") {
      const id = Number(msg.mandate_id);
      if (refusal) return { kind: "fund", ok: false, reason: refusal };
      const used = String(successValue(o.status) ?? "");
      if (args?.amount !== undefined && used !== String(args.amount))
        return { kind: "fund", ok: false, reason: `the token reports ${used || "nothing"} of ${String(args.amount)} used — refunded` };
      return { kind: "fund", ok: true, mandateId: id, added: used };
    }
    if (refusal) return { kind: "open", ok: false, reason: refusal };
    const d = vaultEvent(o, "mandate_opened");
    if (d) return { kind: "open", ok: true, mandateId: Number(d.mandate_id), escrowed: String(d.escrow) };
    return { kind: "open", ok: false, reason: "the vault did not report opening a mandate" };
  }

  if (!toVault) return top ? { kind: "other", ok: false, reason: top } : { kind: "other", ok: true };

  if (method === "storage_deposit") {
    if (top) return { kind: "other", ok: false, reason: top };
    return { kind: "storage_deposit", ok: true, credited: String(successValue(o.status) ?? "") };
  }
  if (method === "withdraw" || method === "storage_withdraw") {
    const failed = top ?? vaultPanic(o);
    if (failed) return { kind: method, ok: false, reason: failed };
    return successValue(o.status) === true
      ? { kind: method, ok: true }
      : { kind: method, ok: false, reason: "the payout did not land, so the vault restored the balance" };
  }
  if (method === "cancel") {
    if (top) return { kind: "other", ok: false, reason: top };
    return { kind: "cancel", ok: true, mandateId: Number(args?.mandate_id ?? vaultEvent(o, "mandate_closed")?.mandate_id) };
  }
  if (method === "reap") {
    if (top) return { kind: "other", ok: false, reason: top };
    return { kind: "reap", ok: true, refunded: String(successValue(o.status) ?? "0") };
  }
  return top ? { kind: "other", ok: false, reason: top } : { kind: "other", ok: true };
}
