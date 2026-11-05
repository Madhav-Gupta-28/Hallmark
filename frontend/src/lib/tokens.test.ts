/**
 * The register is permissionless, so "which asset is this, really" is a
 * question the UI has to answer honestly rather than guess at.
 */
import { describe, expect, it } from "vitest";
import { bothListed, FLOOR, meta, type TokenTable } from "./tokens";

const LISTED: TokenTable = {
  ...FLOOR,
  "nep141:token.sweat": { symbol: "SWEAT", dp: 18 },
};

describe("meta", () => {
  it("reports a listed asset's real symbol and decimals", () => {
    expect(meta(LISTED, "nep141:wrap.near")).toEqual({ symbol: "wNEAR", dp: 24 });
  });

  it("marks an unlisted asset unknown instead of assuming 18 decimals", () => {
    // app.js assumes 18 here. Assuming decimals for a token nobody lists turns
    // a raw base-unit figure into a plausible-looking price.
    expect(meta(LISTED, "nep141:evil.near")).toEqual({ symbol: "EVIL", dp: null });
  });
});

describe("bothListed", () => {
  it("passes the vault's own pair", () => {
    expect(bothListed(LISTED, "nep141:wrap.near", "nep141:usdt.tether-token.near")).toBe(true);
  });

  it("fails when a filler would be paid in a token the venue never heard of", () => {
    expect(bothListed(LISTED, "nep141:evil.near", "nep141:usdt.tether-token.near")).toBe(false);
  });

  it("fails on an asset whose name merely resembles a real one", () => {
    expect(bothListed(LISTED, "nep141:usdt.tether-token.near.evil.near")).toBe(false);
  });

  it("still trusts the floor pair when 1Click's list is unavailable", () => {
    // tokensQuery falls back to FLOOR, so the pair the vault is actually used
    // with must not light up as unlisted during an outage.
    expect(bothListed(FLOOR, "nep141:wrap.near", "nep141:usdt.tether-token.near")).toBe(true);
    expect(bothListed(FLOOR, "nep141:token.sweat")).toBe(false);
  });
});
