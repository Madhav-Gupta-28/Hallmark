/* ============================================================================
   Hallmark — the shared runtime.

   This began as a port of the static site's hallmark.js, which was the
   reference implementation until this app replaced it. The canonicaliser is
   still not the only one: `fixtures/mkfix.py` (Python, from-scratch ed25519)
   and `client/src/lib/canonical.ts` derive the same bytes and the same hash
   independently, and the contract verifies against them on every sandbox run.
   If this file and those two ever disagree, they are right and this is the bug.

   Deliberately NOT ported: the DOM chrome (`chrome`, `reveal`, `odometer`,
   `MARK`, the theme toggle) and the HTML-string helpers (`esc`, `rows`).
   React renders those, and escapes for free. `fixtures()` is ported, but loads
   from a build-time module instead of fetching a generated JSON file.

   The load-bearing property, unchanged: **this code computes almost nothing.**
   It canonicalises a quote and asks `hallmarkfi.near` for every number.
   ========================================================================= */

export const VAULT = "hallmarkfi.near";

/**
 * Three endpoints, tried in order. The public NEAR RPC rate-limits bursts and
 * the browser reports that as a bare "Failed to fetch", so every call goes
 * through a queue that bounds concurrency, retries with backoff, and fails
 * over. All three answer `Access-Control-Allow-Origin: *`.
 *
 *   The reference lists `https://1rpc.io/near` third. It is dead for this use:
 *   it answers every `query` (and `status`) with JSON-RPC -32601 "the method
 *   query does not exist/is not available", pinned or unpinned, so it
 *   only ever costs a failed attempt plus backoff. Replaced here with
 *   `https://near.drpc.org` (a different operator from the other two).
 *
 *   Verified live 2026-11-03, against hallmarkfi.near:
 *   - unpinned (`finality: "final"`) and pinned (`block_id`) `call_function`
 *     both answer, and pinned results are byte-identical to rpc.mainnet.near.org
 *     at the same block (12/12);
 *   - 30/30 OK at this file's concurrency (3 in flight), median ~400 ms;
 *   - CORS: POST answers `Access-Control-Allow-Origin: *`; the preflight
 *     answers 204 allowing `content-type`.
 *   One unpinned call timed out (10 s) in the first probe, which is why it sits
 *   last rather than second.
 *
 *   ORDER ALSO DIFFERS — measured 2026-11-04, five `open_mandate_count` views
 *   each: rpc.mainnet.near.org answered every one, but in 3.6–4.6 s;
 *   free.rpc.fastnear.com in 0.5–1.0 s; near.drpc.org in 0.7–1.1 s. Failover
 *   only triggers on errors, so a slow-but-answering first endpoint made every
 *   page wait ~4 s per call (Exhibit A took 17 s). Fastest first; the official
 *   endpoint stays as the last resort.
 *
 *   Also tried and rejected that day: near.lava.build (410, discontinued),
 *   rpc.ankr.com/near and near.blockpi.network (API key required),
 *   endpoints.omniatech.io (521), near-mainnet.public.blastapi.io and
 *   near.rpc.grove.city (unreachable), rpc.intea.rs (works, but 429 on 30/30
 *   requests in a 3-wide burst, ~1.5 s median). rpc.mainnet.fastnear.com and
 *   archival-rpc.mainnet.fastnear.com work but are the same operator as
 *   free.rpc.fastnear.com, so they add no independence.
 */
export const RPCS = [
  "https://free.rpc.fastnear.com",
  "https://near.drpc.org",
  "https://rpc.mainnet.near.org",
] as const;
export const RPC = RPCS[0];                // the first tried, not "the official" one
export const API = "https://1click.chaindefuser.com";
export const SIGNER = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";
export const EXPLORER = "https://nearblocks.io";

/* ---------------------------------------------------------------------- types */

/** `Mandate` in contract/src/mandate.rs, as JSON. U128/U64 arrive as strings. */
export interface MandateTerms {
  origin_asset: string;
  destination_asset: string;
  recipient: string;
  max_cost_bps: number;
  max_fill: string;
  max_quote_age_secs: number;
  expiry_ns: string;
}

/** `MandateRecord` in contract/src/lib.rs, as JSON. */
export interface MandateRecord {
  owner: string;
  terms: MandateTerms;
  escrow: string;
  delivered: string;
  fills: number;
  worst_bps: number;
  open: boolean;
}

/** What `get_mandates` returns: `Vec<(u64, MandateRecord)>`. */
export type BookEntry = [id: number, record: MandateRecord];

/** A 1Click `/v0/quote` response — only the parts this project reads. */
export interface QuoteResponse {
  quote: Record<string, unknown>;
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
  [k: string]: unknown;
}

export interface TxAction {
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
}

/** The project's own transaction shape — deliberately not a wallet library's. */
export interface Tx {
  receiverId: string;
  actions: TxAction[];
}

/* ----------------------------------------------------------------- view calls */

/** At most this many RPC requests in flight at once, across the whole page. */
const MAX_INFLIGHT = 3;
let inflight = 0;
const waiting: Array<() => void> = [];

function slot(): Promise<void> {
  if (inflight < MAX_INFLIGHT) { inflight++; return Promise.resolve(); }
  return new Promise((go) => waiting.push(go));
}
function release(): void {
  const next = waiting.shift();
  if (next) next();
  else inflight--;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type FinalError = Error & { final?: boolean };

/**
 * One JSON-RPC request, queued, retried, and failed over. `method` defaults to
 * `query`, which is all the reference uses; the frontend also reads `tx`.
 *
 * `timeoutMs` (default: none, as in the reference) bounds each attempt, so a
 * node that holds the connection open fails over instead of stalling. `tx`
 * needs it: asked with `wait_until` about a transaction it does not have — not
 * archival, or not yet seen — a node waits rather than answering; measured on
 * rpc.mainnet.near.org and free.rpc.fastnear.com, 2026-11-03, >20 s each.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc(
  params: Record<string, unknown>, label: string, method = "query", timeoutMs?: number,
): Promise<any> {
  await slot();
  try {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < RPCS.length * 2; attempt++) {
      const url = RPCS[attempt % RPCS.length];
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
        });
        if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
        const b = await r.json();
        // A contract-level error is an answer, not a transport failure: do not retry.
        if (b.result?.error) throw Object.assign(new Error(`${label}: ${b.result.error}`), { final: true });
        if (b.error) throw new Error(b.error.message ?? "rpc error");
        if (!b.result) throw new Error("empty result");
        return b.result;
      } catch (e) {
        if ((e as FinalError).final) throw e;
        lastErr = e as Error;
        await sleep(160 * (attempt + 1));          // back off, then try the next endpoint
      }
    }
    throw new Error(`${label}: the chain did not answer — ${lastErr?.message ?? "unknown"}`);
  } finally {
    release();
  }
}

/* Identical view calls get asked for repeatedly, so they are cached for a few
   seconds. Nothing here is a write, so a stale read is only ever a stale read.
   (TanStack Query caches on top of this; the two do not conflict.) */
const cache = new Map<string, { at: number; p: Promise<unknown> }>();
const TTL = 8000;

/** A keyless `call_function` view. No key, no account, no deposit, no server. */
export async function view<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const key = method + JSON.stringify(args);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;

  const p = rpc({
    request_type: "call_function", finality: "final", account_id: VAULT,
    method_name: method,
    args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args)))),
  }, method).then((res) => JSON.parse(new TextDecoder().decode(new Uint8Array(res.result))) as T);

  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));               // never cache a failure
  return p;
}

/**
 * A keyless view, optionally pinned to a block, that also reports which block
 * answered. Not in the reference runtime: `view` always reads the latest final
 * block, which is right for a single read and wrong for a multi-call read that
 * must see one consistent state (paging `get_mandates`). Uncached on purpose —
 * a pinned read never changes, and an unpinned one is only used to learn the
 * block to pin the rest to.
 */
export async function viewAt<T = unknown>(
  method: string,
  args: Record<string, unknown> = {},
  blockId?: number,
): Promise<{ value: T; blockHeight: number }> {
  const res = await rpc({
    request_type: "call_function",
    ...(blockId === undefined ? { finality: "final" } : { block_id: blockId }),
    account_id: VAULT,
    method_name: method,
    args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args)))),
  }, method);
  return {
    value: JSON.parse(new TextDecoder().decode(new Uint8Array(res.result))) as T,
    blockHeight: res.block_height,
  };
}

/**
 * A keyless view on any contract — the token contracts, for balances and
 * storage registration. Not in the reference, which only ever reads the vault.
 * Same queue, failover and short cache as `view`.
 */
export async function viewOn<T = unknown>(
  accountId: string, method: string, args: Record<string, unknown> = {},
): Promise<T> {
  const key = `on:${accountId}:${method}${JSON.stringify(args)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;
  const p = rpc({
    request_type: "call_function", finality: "final", account_id: accountId,
    method_name: method,
    args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args)))),
  }, `${accountId}.${method}`).then((res) => JSON.parse(new TextDecoder().decode(new Uint8Array(res.result))) as T);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/** Drop cached reads, e.g. after a transaction lands, so the next read is fresh. */
export function forgetCache(): void {
  cache.clear();
}

export interface AccountView {
  amount: string;
  locked: string;
  code_hash: string;
  storage_usage: number;
  block_height: number;
  block_hash: string;
}

/** Account state straight off the chain — balance, storage, code hash. */
export async function viewAccount(id: string = VAULT): Promise<AccountView> {
  const key = "acct:" + id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<AccountView>;
  const p = rpc({ request_type: "view_account", finality: "final", account_id: id }, "view_account") as Promise<AccountView>;
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/* ------------------------------------------------------------ canonical form */

/** Exactly the request fields 1Click's signature covers, in the SDK's order. */
const SIGNED_REQ = [
  "dry", "swapType", "slippageTolerance", "originAsset", "depositType",
  "destinationAsset", "amount", "refundTo", "refundType", "recipient",
  "recipientType", "deadline", "quoteWaitingTimeMs", "referral",
] as const;

/** Exactly the quote fields it covers. */
const SIGNED_QUOTE = [
  "amountIn", "amountInFormatted", "amountInUsd", "minAmountIn",
  "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut",
] as const;

/**
 * `appFees` and `depositAddress` are absent on purpose — 1Click does not sign
 * either, so nothing in this project may read them. See ARCHITECTURE.md §3.2.
 */
export const UNSIGNED = [
  "appFees", "depositAddress", "depositMemo", "depositMode",
  "confidentiality", "insured", "timeEstimate", "refundFee",
  "withdrawFee", "correlationId",
] as const;

/** JSON with keys sorted and `undefined` dropped — `json-stable-stringify`. */
export function stable(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
  const r = o as Record<string, unknown>;
  const keys = Object.keys(r).filter((k) => r[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(r[k])).join(",") + "}";
}

/** The exact byte string the venue signed, and that the contract re-hashes. */
export function canonicalise(res: QuoteResponse): string {
  const p: Record<string, unknown> = {};
  for (const k of SIGNED_REQ) {
    const v = res.quoteRequest[k];
    // 1Click drops falsy `quoteWaitingTimeMs` and `referral` before signing.
    if (k === "quoteWaitingTimeMs" || k === "referral") { if (v) p[k] = v; continue; }
    if (v !== undefined && v !== null) p[k] = v;
  }
  for (const k of SIGNED_QUOTE) {
    const v = res.quote[k];
    if (v !== undefined && v !== null) p[k] = v;
  }
  p.timestamp = res.timestamp;
  return stable(p);
}

/* -------------------------------------------------------------- 1Click, maybe
   The venue can be down — HTTP 521 for forty minutes on 2026-11-02 — so every
   call reports what actually happened, and pages that need nothing from the
   venue keep working. */

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  [k: string]: unknown;
}

export async function getTokens(): Promise<OneClickToken[]> {
  const r = await fetch(`${API}/v0/tokens`);
  if (!r.ok) throw new Error(`the 1Click token list is unavailable (HTTP ${r.status})`);
  return r.json();
}

export interface QuoteParams {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  slippageTolerance?: number;
  deadline?: string;
}

export async function getQuote(p: QuoteParams): Promise<QuoteResponse> {
  const r = await fetch(`${API}/v0/quote`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dry: true, swapType: "EXACT_INPUT",
      slippageTolerance: p.slippageTolerance ?? 100,
      originAsset: p.originAsset, depositType: "ORIGIN_CHAIN",
      destinationAsset: p.destinationAsset, amount: p.amount,
      refundTo: p.recipient, refundType: "ORIGIN_CHAIN",
      recipient: p.recipient, recipientType: "DESTINATION_CHAIN",
      deadline: p.deadline ?? new Date(Date.now() + 36e5).toISOString(),
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = JSON.parse(text).message || msg; } catch { /* not JSON */ }
    throw new Error(`1Click will not quote this right now — ${msg}`);
  }
  return JSON.parse(text);
}

/* ------------------------------------------------------------------ fixtures
   The signed captures. The reference fetches assets/fixtures.json, generated
   from contract/fixtures/ by tools/mkfixtures.py. Here the same object
   comes from the `virtual:hallmark-fixtures` module, built from the same files
   by ../../fixtures.ts at build time — never transcribed by hand. Loaded lazily
   so it stays out of the main bundle, and cached like the reference. */

export interface Fixture {
  canonical: string;
  /** base58, no `ed25519:` prefix */
  signature: string;
  bytes: number;
  quoteHash: string;
  note: string;
}
export type Fixtures = Record<"honest" | "worst" | "sandbox", Fixture>;

let _fx: Promise<Fixtures> | undefined;
export function fixtures(): Promise<Fixtures> {
  if (!_fx) {
    _fx = import("virtual:hallmark-fixtures").then((m) => m.default);
    _fx.catch(() => { _fx = undefined; });        // a failed chunk load may be retried
  }
  return _fx;
}

/* -------------------------------------------------------------------- format */

/** Base units to a human string, exactly — never via a float. */
export function units(v: string | bigint | number, dp: number, places = 6): string {
  const s = BigInt(v).toString().padStart(dp + 1, "0");
  const whole = s.slice(0, s.length - dp);
  const frac = dp ? s.slice(s.length - dp) : "";
  return places ? `${whole}.${frac.slice(0, places).padEnd(places, "0")}` : whole;
}

export function age(secs: string | number): string {
  const n = Number(secs);
  if (n < 120) return `${n}s`;
  if (n < 7200) return `${Math.round(n / 60)} min`;
  if (n < 172800) return `${(n / 3600).toFixed(1)} h`;
  return `${(n / 86400).toFixed(1)} days`;
}

export const near = (yocto: string | bigint, dp = 5) => (Number(BigInt(yocto)) / 1e24).toFixed(dp);
export const tx = (h: string) => `${EXPLORER}/txns/${h}`;
export const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

/* ===========================================================================
   Transactions. Pure: intent in, the exact receiver/method/args/gas/deposit
   out. Used for both the wallet path and the CLI rendering, so the command a
   user copies cannot drift from the transaction a button sends.
   ======================================================================== */

export const ONE_YOCTO = "1";
export const TGAS = (n: number | bigint) => String(BigInt(n) * 1_000_000_000_000n);

/** A decimal string to base units, exactly. Never via a float. */
export function parseUnits(human: string | number, dp: number): string {
  const t = String(human).trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`not a positive decimal amount: "${t}"`);
  const [i, f = ""] = t.split(".");
  if (f.length > dp) throw new Error(`"${t}" has more than ${dp} decimal places`);
  return BigInt(i + f.padEnd(dp, "0")).toString();
}

/** The NEP-141 contract behind a `nep141:<id>` asset id. */
export const tokenOf = (asset: string) => String(asset).replace(/^nep141:/, "");

/** Prepay storage. Needed once per account, before the first mandate. */
export const txStorageDeposit = (yocto: string | bigint): Tx => ({
  receiverId: VAULT,
  actions: [{ methodName: "storage_deposit", args: {}, gas: TGAS(30), deposit: String(yocto) }],
});

/** Open a mandate: the transfer of the origin asset IS the escrow. */
export const txOpen = (terms: MandateTerms, amount: string | bigint): Tx => ({
  receiverId: tokenOf(terms.origin_asset),
  actions: [{
    methodName: "ft_transfer_call",
    args: { receiver_id: VAULT, amount: String(amount),
            msg: JSON.stringify({ action: "open", terms }) },
    gas: TGAS(100), deposit: ONE_YOCTO,
  }],
});

/** Fill a mandate: the transfer of the destination asset IS the delivery. */
export const txFill = (
  destAsset: string, mandateId: number, canonical: string, signature: string, amount: string | bigint,
): Tx => ({
  receiverId: tokenOf(destAsset),
  actions: [{
    methodName: "ft_transfer_call",
    args: { receiver_id: VAULT, amount: String(amount),
            msg: JSON.stringify({ action: "fill", mandate_id: mandateId, canonical, signature }) },
    gas: TGAS(100), deposit: ONE_YOCTO,
  }],
});

/**
 * Top up an open mandate's escrow: the transfer of the origin asset IS the
 * top-up. Not in the reference, which never exposed `Action::Fund`. The
 * contract accepts it only from the owner, on an open, unexpired mandate, in
 * the mandate's origin asset.
 */
export const txFund = (originAsset: string, mandateId: number, amount: string | bigint): Tx => ({
  receiverId: tokenOf(originAsset),
  actions: [{
    methodName: "ft_transfer_call",
    args: { receiver_id: VAULT, amount: String(amount),
            msg: JSON.stringify({ action: "fund", mandate_id: mandateId }) },
    gas: TGAS(100), deposit: ONE_YOCTO,
  }],
});

export const txWithdraw = (asset: string): Tx => ({
  receiverId: VAULT,
  actions: [{ methodName: "withdraw", args: { asset }, gas: TGAS(60), deposit: ONE_YOCTO }],
});
export const txCancel = (id: number): Tx => ({
  receiverId: VAULT,
  actions: [{ methodName: "cancel", args: { mandate_id: id }, gas: TGAS(30), deposit: "0" }],
});
export const txReap = (id: number): Tx => ({
  receiverId: VAULT,
  actions: [{ methodName: "reap", args: { mandate_id: id }, gas: TGAS(30), deposit: "0" }],
});
export const txStorageWithdraw = (): Tx => ({
  receiverId: VAULT,
  actions: [{ methodName: "storage_withdraw", args: {}, gas: TGAS(60), deposit: ONE_YOCTO }],
});

/** The same transaction, as a command. One source of truth, two renderings. */
export function cliFor(txs: Tx[], signer = "YOUR_ACCOUNT.near"): string {
  return txs.map((t) => t.actions.map((a) =>
    `near contract call-function as-transaction ${t.receiverId} ${a.methodName} \\\n` +
    `  json-args '${JSON.stringify(a.args)}' \\\n` +
    `  prepaid-gas '${Number(BigInt(a.gas) / 1_000_000_000_000n)} Tgas' \\\n` +
    `  attached-deposit '${a.deposit === "0" ? "0 NEAR" : a.deposit === "1" ? "1 yoctoNEAR" : near(a.deposit, 5) + " NEAR"}' \\\n` +
    `  sign-as ${signer} network-config mainnet sign-with-keychain send`
  ).join("\n\n")).join("\n\n");
}
