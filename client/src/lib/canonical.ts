/**
 * The reference canonicaliser.
 *
 * The contract never serialises JSON. It is handed the exact bytes this module
 * produces, hashes them, verifies the venue's signature over that hash, and
 * then parses the same bytes — so Rust has no canonical form of its own to
 * drift out of sync (ARCHITECTURE.md §2.6).
 *
 * There are nevertheless three canonicalisers, on purpose: this one,
 * `fixtures/mkfix.py` (Python, with from-scratch ed25519) and the browser port
 * in `frontend/src/lib/hallmark.ts`. One implementation can be confidently
 * wrong; three that agree byte for byte and hash for hash on all three
 * captured fixtures cannot be, and `frontend/src/lib/hallmark.test.ts` checks
 * exactly that against this file on every build. This one is the reference the
 * others are measured against.
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
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

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

/**
 * The 1Click quote signer, hardcoded in the contract too. If a live quote ever
 * fails to verify against this, the venue has rotated its key and every fill
 * will be refused on-chain until the contract knows the new one — which is why
 * `verifySigner` exists and why CI checks a live quote (ARCHITECTURE.md §14).
 */
export const QUOTE_SIGNER = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/**
 * Did the venue sign these bytes with the key the contract trusts?
 *
 * Exactly what the contract does: hash, base58 the digest, and verify the
 * signature over the UTF-8 of *that string* — not over the digest.
 */
export function verifySigner(canonical: string, signature: string, signer = QUOTE_SIGNER): boolean {
  const raw = bs58.decode(signer.replace(/^ed25519:/, ""));
  if (raw.length !== 32) throw new Error("signer key must be 32 bytes");
  // SPKI wrapper for a raw ed25519 public key
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(raw),
  ]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  const message = Buffer.from(quoteHash(canonical), "utf8");
  return cryptoVerify(null, message, key, bs58.decode(signature.replace(/^ed25519:/, "")));
}

/**
 * How old the venue's signature on this quote is, in seconds. The cost bound is
 * denominated in USD marks that were true at `timestamp` and not necessarily
 * now, and the *filler* picks the quote's `deadline` — 1Click will sign one ten
 * years out — so this, not the deadline, is what a mandate must bound
 * (ARCHITECTURE.md §2.10).
 */
export function quoteAgeSecs(res: QuoteResponse, now = Date.now()): number {
  return Math.max(0, Math.round((now - new Date(res.timestamp).getTime()) / 1000));
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
  // Must agree with `parse_fixed` in contract/src/quote.rs on every input the
  // venue can produce, including the degenerate ones. The obvious
  // `BigInt(i ?? "0")` silently reads ".5" as 0.5 where Rust panics, so the
  // integer part is required here too — the two implementations are only
  // equivalent if they disagree about nothing.
  const scale = (s: string) => {
    const [i, f = ""] = s.split(".");
    if (!/^\d+$/.test(i ?? "")) throw new Error(`bad integer part in "${s}"`);
    if (f && !/^\d+$/.test(f)) throw new Error(`bad fraction in "${s}"`);
    return BigInt(i!) * 10n ** 12n + BigInt((f + "000000000000").slice(0, 12));
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
