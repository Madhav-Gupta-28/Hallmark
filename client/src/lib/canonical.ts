/**
 * Canonicalisation lives here and nowhere else.
 *
 * The contract never serialises JSON. It is handed the exact bytes this module
 * produces, hashes them, verifies the venue's signature over that hash, and
 * then parses the same bytes. So there is no second implementation of canonical
 * form to drift out of sync — see ARCHITECTURE.md §2.6.
 *
 * Two details are easy to get wrong and fatal if you do:
 *   1. the signed payload is a *subset* of the quote — `appFees`,
 *      `depositAddress`, `depositMode`, `confidentiality` and `insured` are
 *      excluded, because 1Click does not sign them (§3.2);
 *   2. the signature is over the UTF-8 of the **base58 string** of the sha256
 *      digest, not over the digest itself (§3.3).
 */
import stringify from "json-stable-stringify";
import bs58 from "bs58";
import { createHash } from "node:crypto";

/** Exactly the request fields 1Click covers, in the SDK's own order. */
const SIGNED_REQUEST_FIELDS = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "deadline",
  "quoteWaitingTimeMs",
  "referral",
] as const;

/** Exactly the quote fields 1Click covers. */
const SIGNED_QUOTE_FIELDS = [
  "amountIn",
  "amountInFormatted",
  "amountInUsd",
  "minAmountIn",
  "amountOut",
  "amountOutFormatted",
  "amountOutUsd",
  "minAmountOut",
] as const;

export interface QuoteResponse {
  quote: Record<string, unknown>;
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
}

/**
 * The byte string the venue signed, and that the contract will re-hash.
 *
 * `json-stable-stringify` sorts keys and omits `undefined` members, which is
 * what 1Click's own SDK relies on.
 */
export function canonicalise(res: QuoteResponse): string {
  const payload: Record<string, unknown> = {};
  for (const k of SIGNED_REQUEST_FIELDS) {
    const v = res.quoteRequest[k];
    // 1Click drops falsy `quoteWaitingTimeMs` and `referral` before signing.
    if (k === "quoteWaitingTimeMs" || k === "referral") {
      if (v) payload[k] = v;
      continue;
    }
    if (v !== undefined && v !== null) payload[k] = v;
  }
  for (const k of SIGNED_QUOTE_FIELDS) {
    const v = res.quote[k];
    if (v !== undefined && v !== null) payload[k] = v;
  }
  payload.timestamp = res.timestamp;

  const out = stringify(payload);
  if (out === undefined) throw new Error("quote is not serialisable");
  return out;
}

/** `base58(sha256(canonical))` — the message the venue actually signed. */
export function quoteHash(canonical: string): string {
  return bs58.encode(createHash("sha256").update(canonical, "utf8").digest());
}

/** The signature, base58, with the `ed25519:` prefix stripped. */
export function signatureB58(res: QuoteResponse): string {
  return res.signature.replace(/^ed25519:/, "");
}

/**
 * The guaranteed-worst all-in cost of a quote, in bps, computed the same way
 * the contract computes it. Useful before spending anything, and the thing the
 * `bound` CLI prints.
 */
export function worstCostBps(res: QuoteResponse): number {
  return costBps(res, BigInt(res.quote.minAmountOut as string));
}

/** The realised all-in cost if a filler delivered `delivered`, in bps. */
export function costBps(res: QuoteResponse, delivered: bigint): number {
  const RATIO = 1_000_000_000n;
  const scale = (s: string) => {
    const [i, f = ""] = s.split(".");
    return BigInt(i ?? "0") * 10n ** 12n + BigInt((f + "000000000000").slice(0, 12));
  };
  const inUsd = scale(res.quote.amountInUsd as string);
  const outUsd = scale(res.quote.amountOutUsd as string);
  const amountOut = BigInt(res.quote.amountOut as string);
  if (inUsd === 0n || amountOut === 0n) throw new Error("quote has no usable mark");

  const valueRatio = (outUsd * RATIO) / inUsd;
  const fillRatio = (delivered * RATIO) / amountOut;
  const kept = (valueRatio * fillRatio) / RATIO;
  if (kept >= RATIO) return 0;
  // round up, exactly as the contract does: the bound must never understate
  const shortfall = (RATIO - kept) * 10_000n;
  return Number((shortfall + RATIO - 1n) / RATIO);
}
