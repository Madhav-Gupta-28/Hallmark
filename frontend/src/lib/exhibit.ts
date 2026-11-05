/**
 * Exhibit A: the signed capture that guarantees a 99.99% loss, priced live by
 * the contract. Nothing about the verdict is hard-coded — it is whatever
 * `dry_check` answers today.
 *
 * The terms are the reference's illustrative ones (300 bps ceiling) with ONE
 * difference: the age bound is the contract's own maximum, 30 days. At the
 * reference's 300 s the capture (signed 2026-10-31) is refused as QuoteTooOld
 * before cost is even read, and the exhibit exists to show the cost clause.
 * After the quote's own signed deadline (2026-11-20) the answer becomes
 * QuoteExpired — and the page will say exactly that, because it prints what
 * the contract returns.
 */
import { fixtures, type MandateTerms } from "./hallmark";
import { priceQuote, type Verdict } from "./price";

/** `MAX_QUOTE_AGE_CEILING_SECS` in contract/src/lib.rs. */
const MAX_AGE_SECS = 30 * 86_400;

export function exhibitTerms(canonical: string): MandateTerms {
  const q = JSON.parse(canonical);
  return {
    origin_asset: q.originAsset,
    destination_asset: q.destinationAsset,
    recipient: q.recipient,
    max_cost_bps: 300,
    max_fill: q.amountIn,
    max_quote_age_secs: MAX_AGE_SECS,
    expiry_ns: "4000000000000000000",
  };
}

export async function exhibitA(): Promise<Verdict & { terms: MandateTerms; note: string }> {
  const f = (await fixtures()).worst;
  const terms = exhibitTerms(f.canonical);
  return { ...(await priceQuote(f.canonical, f.signature, terms)), terms, note: f.note };
}
