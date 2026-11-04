/**
 * The fixtures the app replays must be exactly the ones the reference serves,
 * and genuinely signed. ../../fixtures.ts is a port of frontend/tools/mkfixtures.py;
 * fixtures.json is that script's committed output (and
 * `mkfixtures.py --check` keeps it in sync with contract/fixtures/).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifySigner } from "../../../client/src/lib/canonical.ts";
import { buildFixtures, NAMES } from "../../fixtures.ts";
import type { MandateRecord } from "./hallmark";
import { captureTerms } from "./price";

const reference = JSON.parse(
  readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"),
);
const built = buildFixtures();

describe("buildFixtures", () => {
  it("produces exactly what tools/mkfixtures.py produced", () => {
    expect(built).toEqual(reference);
  });

  it.each(NAMES)("%s verifies against the trusted signer", (name) => {
    expect(verifySigner(built[name].canonical, built[name].signature)).toBe(true);
  });
});

describe("captureTerms", () => {
  const { canonical } = built.worst;
  const q = JSON.parse(canonical);
  const mandate = (origin: string, dest: string): MandateRecord => ({
    owner: "o.near", escrow: "1", delivered: "0", fills: 0, worst_bps: 0, open: true,
    terms: {
      origin_asset: origin, destination_asset: dest, recipient: "hallmarkfi.near",
      max_cost_bps: 25, max_fill: "9", max_quote_age_secs: 60, expiry_ns: "1",
    },
  });

  it("uses the live mandate's real terms when the pair matches", () => {
    const m = mandate(q.originAsset, q.destinationAsset);
    expect(captureTerms(canonical, m)).toEqual({ terms: m.terms, useLive: true });
  });

  it("falls back to app.js's illustrative terms for a different pair", () => {
    expect(captureTerms(canonical, mandate("nep141:wrap.near", "nep141:usdt.tether-token.near"))).toEqual({
      useLive: false,
      terms: {
        origin_asset: q.originAsset, destination_asset: q.destinationAsset, recipient: q.recipient,
        max_cost_bps: 300, max_fill: q.amountIn, max_quote_age_secs: 300, expiry_ns: "4000000000000000000",
      },
    });
  });

  it("falls back when there is no mandate", () => {
    expect(captureTerms(canonical, null).useLive).toBe(false);
  });
});
