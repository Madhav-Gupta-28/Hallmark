/**
 * The ported canonicaliser must produce, byte for byte, what the reference
 * client produces — otherwise a quote this app hands to `is_signed` or
 * `dry_check` is refused even though the venue really signed it.
 *
 * Three independent witnesses, all over the same genuine signed captures:
 *   1. client/src/lib/canonical.ts — the reference implementation;
 *   2. contract/fixtures/*.canonical.json — the exact bytes the contract's own
 *      tests verify a NEAR Intents signature over;
 *   3. the hashes recorded in ARCHITECTURE.md §3.3.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import stringify from "json-stable-stringify";
import {
  canonicalise as reference,
  quoteHash,
  verifySigner,
  type QuoteResponse as RefQuoteResponse,
} from "../../../client/src/lib/canonical.ts";
import { canonicalise, stable, SIGNER, UNSIGNED, type QuoteResponse } from "./hallmark";

const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);
const load = (name: string): QuoteResponse =>
  JSON.parse(readFileSync(repo(`fixtures/${name}.quote.json`), "utf8"));

// fixture, hash from ARCHITECTURE.md §3.3, byte length
const CASES = [
  ["honest", "8no2rMSjesYe97Jhi6RWKxRvvYsYARBVQZXtMDMyhvwp", 692],
  ["worst", "FTTFigJiyLLbx9Um6FC17P8UvRwfuSA1DRMDeNZvTj33", 690],
  ["sandbox", "5TV8CQDmjsTexoYFKLvT6rwdVzGqcJ13tnBcx1eyqdZB", 681],
] as const;

describe.each(CASES)("canonicalise(%s)", (name, hash, bytes) => {
  const res = load(name);
  const ported = canonicalise(res);

  it("matches client/src/lib/canonical.ts byte for byte", () => {
    expect(ported).toBe(reference(res as RefQuoteResponse));
  });

  it("matches the bytes the contract's tests verify", () => {
    const onChain = readFileSync(repo(`contract/fixtures/${name}.canonical.json`), "utf8");
    expect(ported).toBe(onChain);
  });

  it("has the recorded length and hash, and the venue's signature verifies", () => {
    expect(new TextEncoder().encode(ported).length).toBe(bytes);
    expect(quoteHash(ported)).toBe(hash);
    expect(verifySigner(ported, res.signature, SIGNER)).toBe(true);
  });

  it("carries no unsigned field", () => {
    for (const k of UNSIGNED) expect(ported).not.toContain(`"${k}"`);
  });
});

describe("stable", () => {
  it("agrees with json-stable-stringify, which the reference client uses", () => {
    const samples: unknown[] = [
      null, 0, -1.5, "x\"y\\z ", true,
      { b: 1, a: [3, { d: undefined, c: null }], e: { z: "", y: [] } },
      [{ k: undefined }, null, "s"],
      ...CASES.map(([n]) => load(n)),
    ];
    for (const s of samples) expect(stable(s)).toBe(stringify(s));
  });
});
