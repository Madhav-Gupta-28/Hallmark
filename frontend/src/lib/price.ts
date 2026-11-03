/**
 * Price a fill against a mandate — the logic of `verdict` and the "Get a live
 * quote" handler in web/assets/app.js, without the DOM.
 *
 * Nothing here computes a cost. It canonicalises the venue's quote and asks
 * the vault six keyless questions; every number shown comes back from
 * `hallmarkfi.near`.
 */
import {
  canonicalise, getQuote, UNSIGNED, view,
  type MandateRecord, type MandateTerms,
} from "./hallmark";

/** The signed fields this page reads back out of the canonical bytes. */
export interface SignedFields {
  amountIn: string;
  amountInUsd: string;
  amountOut: string;
  amountOutUsd: string;
  minAmountOut: string;
  originAsset: string;
  destinationAsset: string;
  recipient: string;
  timestamp: string;
  deadline: string;
}

export interface Verdict {
  q: SignedFields;
  canonical: string;
  /** `is_signed` */
  signed: boolean;
  /** `worst_cost` — the cost if only the signed floor (`minAmountOut`) is delivered */
  worstBps: number;
  /** `realised_cost` at `amountOut` — the cost if the quote is honoured in full */
  fullBps: number;
  /** `quote_age_secs`, as the chain sees it */
  ageSecs: number;
  /** `dry_check` delivering `minAmountOut`, verbatim */
  atFloor: string;
  /** `dry_check` delivering `amountOut`, verbatim */
  atFull: string;
  /** unsigned field names found in the canonical bytes; must be empty */
  leaked: string[];
  /** is `amountIn` within the mandate's `max_fill` */
  fillable: boolean;
}

type ViewFn = <T>(method: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * The largest fill this mandate will actually take: min(escrow, max_fill).
 * Same as app.js, which quotes this amount.
 */
export function quoteAmount(m: MandateRecord): string {
  const escrow = BigInt(m.escrow);
  const cap = BigInt(m.terms.max_fill);
  const amount = escrow < cap ? escrow : cap;
  if (amount === 0n) throw new Error("this mandate has no escrow left to fill against");
  return amount.toString();
}

/** A live, signed `dry: true` quote for this mandate's pair and size. Commits nothing. */
export async function liveQuote(m: MandateRecord): Promise<{ canonical: string; signature: string }> {
  const t = m.terms;
  const res = await getQuote({
    originAsset: t.origin_asset,
    destinationAsset: t.destination_asset,
    amount: quoteAmount(m),
    recipient: t.recipient,
  });
  return { canonical: canonicalise(res), signature: res.signature.replace(/^ed25519:/, "") };
}

/** The six view calls `verdict` makes in app.js, with the same arguments, in parallel. */
export async function priceQuote(
  canonical: string,
  signature: string,
  terms: MandateTerms,
  v: ViewFn = view,
): Promise<Verdict> {
  const q = JSON.parse(canonical) as SignedFields;
  const [signed, worst, full, ageS, atFloor, atFull] = await Promise.all([
    v<boolean>("is_signed", { canonical, signature }),
    v<number>("worst_cost", { canonical }),
    v<number>("realised_cost", { canonical, delivered: q.amountOut }),
    v<string>("quote_age_secs", { canonical }),
    v<string>("dry_check", { canonical, signature, terms, delivered: q.minAmountOut }),
    v<string>("dry_check", { canonical, signature, terms, delivered: q.amountOut }),
  ]);
  return {
    q, canonical, signed,
    worstBps: Number(worst),
    fullBps: Number(full),
    ageSecs: Number(ageS),
    atFloor, atFull,
    leaked: UNSIGNED.filter((u) => canonical.includes(u)),
    fillable: BigInt(q.amountIn) <= BigInt(terms.max_fill),
  };
}

/**
 * The terms to price a captured quote against — the `#pfx` handler in app.js.
 * Against the live mandate's real terms when its pair matches the capture's,
 * so the comparison is honest; otherwise against the capture's own pair with
 * the reference's fixed illustrative terms (300 bps ceiling, 300 s age bound).
 */
export function captureTerms(
  canonical: string,
  mandate: MandateRecord | null,
): { terms: MandateTerms; useLive: boolean } {
  const q = JSON.parse(canonical) as SignedFields;
  const useLive = !!mandate
    && mandate.terms.origin_asset === q.originAsset
    && mandate.terms.destination_asset === q.destinationAsset;
  if (useLive) return { terms: mandate!.terms, useLive };
  return {
    useLive,
    terms: {
      origin_asset: q.originAsset, destination_asset: q.destinationAsset,
      recipient: q.recipient, max_cost_bps: 300, max_fill: q.amountIn,
      max_quote_age_secs: 300, expiry_ns: "4000000000000000000",
    },
  };
}

export interface ParsedCheck {
  allowed: boolean;
  /** realised cost in bps, when allowed */
  costBps?: number;
  /** origin base units the filler would earn, when allowed */
  earns?: string;
  /** the refusal variant name, e.g. `CostCeilingBreached`, when refused */
  reason?: string;
}

/**
 * Read `dry_check`'s string for display. The string itself is always shown
 * verbatim too — it is what the chain said — this only pulls out the parts a
 * reader needs glossed, like app.js's `gloss`.
 */
export function parseCheck(s: string): ParsedCheck {
  const ok = /^ALLOWED at (\d+) bps realised all-in cost, filler earns (\d+) origin units$/.exec(s);
  if (ok) return { allowed: true, costBps: Number(ok[1]), earns: ok[2] };
  const no = /^REFUSED (\w+)/.exec(s);
  return { allowed: false, reason: no?.[1] };
}

/** A refusal variant, in the words a reader would use, and the clause it breaches. */
export const REFUSAL: Record<string, { words: string; clause: string }> = {
  CostCeilingBreached: { words: "over the ceiling", clause: "§1" },
  UnderDelivered: { words: "under the signed floor", clause: "§1" },
  BadSignature: { words: "not signed by the venue", clause: "§2" },
  WrongAsset: { words: "wrong asset", clause: "§2" },
  WrongRecipient: { words: "wrong recipient", clause: "§2" },
  QuoteTooOld: { words: "quote too old", clause: "§3" },
  QuoteExpired: { words: "quote past its deadline", clause: "§3" },
  MandateExpired: { words: "agreement expired", clause: "§3" },
  FillTooLarge: { words: "fill too large", clause: "§1" },
};
export const refusalOf = (reason?: string) => (reason && REFUSAL[reason]) || { words: reason ?? "refused", clause: "§" };
