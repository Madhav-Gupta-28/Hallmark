import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalise, type MandateRecord, type MandateTerms, type QuoteResponse } from "./hallmark";
import { parseCheck, priceQuote, quoteAmount } from "./price";

const worst: QuoteResponse = JSON.parse(
  readFileSync(new URL("../../../fixtures/worst.quote.json", import.meta.url), "utf8"),
);

const terms: MandateTerms = {
  origin_asset: "nep141:wrap.near",
  destination_asset: "nep141:usdt.tether-token.near",
  recipient: "hallmarkfi.near",
  max_cost_bps: 300,
  max_fill: "40000000000000000000000",
  max_quote_age_secs: 300,
  expiry_ns: "1796231333050000000",
};
const rec = (escrow: string, max_fill = terms.max_fill): MandateRecord => ({
  owner: "o.near", terms: { ...terms, max_fill }, escrow, delivered: "0", fills: 0, worst_bps: 0, open: true,
});

describe("quoteAmount", () => {
  it("quotes the cap when escrow exceeds it", () => {
    expect(quoteAmount(rec("90", "40"))).toBe("40");
  });
  it("quotes the escrow when it is below the cap", () => {
    expect(quoteAmount(rec("7", "40"))).toBe("7");
  });
  it("refuses an empty mandate", () => {
    expect(() => quoteAmount(rec("0"))).toThrow(/no escrow/);
  });
});

describe("priceQuote", () => {
  it("asks exactly what app.js asks, with floor and full deliveries", async () => {
    const canonical = canonicalise(worst);
    const sig = worst.signature.replace(/^ed25519:/, "");
    const calls: Array<[string, Record<string, unknown>]> = [];
    const answers: Record<string, unknown> = {
      is_signed: true, worst_cost: 10000, realised_cost: 503, quote_age_secs: "42",
    };
    const v = async <T,>(m: string, a: Record<string, unknown> = {}) => {
      calls.push([m, a]);
      if (m === "dry_check") return (a.delivered === JSON.parse(canonical).minAmountOut ? "REFUSED floor" : "ALLOWED full") as T;
      return answers[m] as T;
    };
    const r = await priceQuote(canonical, sig, terms, v);
    const q = JSON.parse(canonical);

    expect(calls).toEqual([
      ["is_signed", { canonical, signature: sig }],
      ["worst_cost", { canonical }],
      ["realised_cost", { canonical, delivered: q.amountOut }],
      ["quote_age_secs", { canonical }],
      ["dry_check", { canonical, signature: sig, terms, delivered: q.minAmountOut }],
      ["dry_check", { canonical, signature: sig, terms, delivered: q.amountOut }],
    ]);
    expect(r).toMatchObject({
      signed: true, worstBps: 10000, fullBps: 503, ageSecs: 42,
      atFloor: "REFUSED floor", atFull: "ALLOWED full", leaked: [],
    });
  });
});

describe("parseCheck", () => {
  it("reads an allowed verdict", () => {
    expect(parseCheck("ALLOWED at 43 bps realised all-in cost, filler earns 1000 origin units"))
      .toEqual({ allowed: true, costBps: 43, earns: "1000" });
  });
  it("reads the refusal variant", () => {
    expect(parseCheck("REFUSED CostCeilingBreached { worst_bps: 10000, ceiling_bps: 30 }"))
      .toEqual({ allowed: false, reason: "CostCeilingBreached" });
    expect(parseCheck("REFUSED BadSignature")).toEqual({ allowed: false, reason: "BadSignature" });
  });
  it("treats anything unrecognised as not allowed", () => {
    expect(parseCheck("something new").allowed).toBe(false);
  });
});
