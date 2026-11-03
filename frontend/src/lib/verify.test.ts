import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFixtures } from "../../fixtures.ts";
import { parseSubmission, termsFor } from "./verify";

const raw = (n: string) => readFileSync(new URL(`../../../fixtures/${n}.quote.json`, import.meta.url), "utf8");
const fx = buildFixtures();

describe("parseSubmission", () => {
  it("canonicalises a full 1Click response to the exact signed bytes", () => {
    const s = parseSubmission(raw("worst"));
    expect(s).toMatchObject({ canonical: fx.worst.canonical, signature: fx.worst.signature, from: "response" });
  });

  it("takes the fixture shape { canonical, signature } as given", () => {
    const s = parseSubmission(JSON.stringify({ canonical: fx.honest.canonical, signature: "ed25519:" + fx.honest.signature }));
    expect(s).toEqual({ canonical: fx.honest.canonical, signature: fx.honest.signature, from: "fixture" });
  });

  it("accepts the canonical payload with the signature pasted apart — same bytes", () => {
    const s = parseSubmission(fx.sandbox.canonical, fx.sandbox.signature);
    expect(s).toEqual({ canonical: fx.sandbox.canonical, signature: fx.sandbox.signature, from: "payload" });
  });

  it("a signature pasted apart overrides the one in the response", () => {
    expect(parseSubmission(raw("worst"), fx.honest.signature).signature).toBe(fx.honest.signature);
  });

  it.each([
    ["", "", /paste a quote/],
    ["not json", "", /not JSON/],
    ["[1,2]", "", /JSON object/],
    ['{"hello":1}', "", /does not look like/],
    [JSON.stringify({ canonical: "x" }), "", /signature is needed/],
    [JSON.stringify({ canonical: "x", signature: "tooShort" }), "", /base58/],
  ])("refuses %j", (text, sig, err) => {
    expect(() => parseSubmission(text, sig)).toThrow(err);
  });
});

describe("termsFor", () => {
  it("takes pair, recipient and size from the quote, bounds from the caller", () => {
    const q = JSON.parse(fx.worst.canonical);
    expect(termsFor(fx.worst.canonical, 300, 600)).toEqual({
      origin_asset: q.originAsset, destination_asset: q.destinationAsset, recipient: q.recipient,
      max_cost_bps: 300, max_fill: q.amountIn, max_quote_age_secs: 600, expiry_ns: "4000000000000000000",
    });
  });
});
