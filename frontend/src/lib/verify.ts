/**
 * /verify — certify any NEAR Intents quote, with no wallet and no mandate.
 *
 * Accepts what people actually have in hand:
 *   1. a full 1Click `/v0/quote` response (quote, quoteRequest, signature,
 *      timestamp) — canonicalised exactly as the reference does;
 *   2. `{ canonical, signature }` — the shape of the captured fixtures;
 *   3. the canonical payload itself as JSON, with the signature given apart.
 * In cases 2 and 3 the bytes the contract hashes are the canonical form of what
 * was pasted. For a payload already canonical that is the same bytes; if it is
 * not, the signature simply will not verify — the contract decides, not us.
 */
import { canonicalise, stable, type MandateTerms, type QuoteResponse } from "./hallmark";

export interface Submission { canonical: string; signature: string; from: "response" | "fixture" | "payload" }

const strip = (s: string) => s.trim().replace(/^ed25519:/, "");

export function parseSubmission(text: string, signatureText = ""): Submission {
  const t = text.trim();
  if (!t) throw new Error("paste a quote first");
  let o: unknown;
  try { o = JSON.parse(t); } catch { throw new Error("that is not JSON — paste the venue's response exactly as it came"); }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("expected a JSON object");
  const r = o as Record<string, unknown>;
  const sig = (fallback?: unknown) => {
    const s = strip(signatureText || (typeof fallback === "string" ? fallback : ""));
    if (!s) throw new Error("a signature is needed — it comes with the venue's response");
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s)) throw new Error("the signature is not base58 of the right length");
    return s;
  };

  if (r.quote && r.quoteRequest && typeof r.timestamp === "string") {
    return { canonical: canonicalise(r as unknown as QuoteResponse), signature: sig(r.signature), from: "response" };
  }
  if (typeof r.canonical === "string") {
    return { canonical: r.canonical, signature: sig(r.signature), from: "fixture" };
  }
  if ("amountIn" in r && "amountOutUsd" in r && "timestamp" in r) {
    return { canonical: stable(r), signature: sig(), from: "payload" };
  }
  throw new Error("this does not look like a NEAR Intents quote: no quote, quoteRequest and timestamp");
}

/** Illustrative terms for a bare quote: the caller's ceiling and age bound, everything else from the quote. */
export function termsFor(canonical: string, ceilingBps: number, maxAgeSecs: number): MandateTerms {
  const q = JSON.parse(canonical);
  return {
    origin_asset: q.originAsset,
    destination_asset: q.destinationAsset,
    recipient: q.recipient,
    max_cost_bps: ceilingBps,
    max_fill: q.amountIn,
    max_quote_age_secs: maxAgeSecs,
    expiry_ns: "4000000000000000000",
  };
}
