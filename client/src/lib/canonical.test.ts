/**
 * The TypeScript canonicaliser must reproduce, byte for byte, what the venue
 * signed — otherwise the contract rejects every real quote. These fixtures are
 * genuine signed captures, and their hashes are recorded in ARCHITECTURE.md §3.3.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { canonicalise, quoteHash, worstCostBps, costBps, type QuoteResponse } from "./canonical.ts";

const load = (n: string): QuoteResponse =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/${n}.quote.json`, import.meta.url), "utf8"));

const cases: [string, string, number, number][] = [
  // fixture, expected hash, bytes, worst-case bps
  ["honest", "8no2rMSjesYe97Jhi6RWKxRvvYsYARBVQZXtMDMyhvwp", 692, 160],
  ["worst", "FTTFigJiyLLbx9Um6FC17P8UvRwfuSA1DRMDeNZvTj33", 690, 10000],
  ["sandbox", "5TV8CQDmjsTexoYFKLvT6rwdVzGqcJ13tnBcx1eyqdZB", 681, 168],
];

let passed = 0;
for (const [name, hash, bytes, worst] of cases) {
  const res = load(name);
  const canonical = canonicalise(res);

  assert.equal(
    Buffer.byteLength(canonical, "utf8"),
    bytes,
    `${name}: canonical length must match the signed bytes`,
  );
  assert.equal(quoteHash(canonical), hash, `${name}: quote hash must match the venue's`);
  assert.equal(worstCostBps(res), worst, `${name}: worst-case cost`);

  // the bytes must not contain a field the venue did not sign
  for (const unsigned of ["appFees", "depositAddress", "depositMode", "confidentiality", "insured"]) {
    assert.ok(!canonical.includes(unsigned), `${name}: ${unsigned} must not be in the signed bytes`);
  }
  console.log(`  ${name.padEnd(8)} ${bytes} bytes  ${hash}  worst ${worst} bps`);
  passed += 4;
}

// delivering the full expected amount always costs less than delivering the floor
for (const name of ["honest", "sandbox"]) {
  const res = load(name);
  const full = costBps(res, BigInt(res.quote.amountOut as string));
  assert.ok(full < worstCostBps(res), `${name}: full delivery must cost less than the floor`);
  console.log(`  ${name.padEnd(8)} at full delivery: ${full} bps`);
  passed++;
}

// the one invariant the bound rests on: rounding never understates the cost
{
  const res = load("honest");
  const delivered = BigInt(res.quote.minAmountOut as string);
  const exact =
    (1 -
      (Number(res.quote.amountOutUsd) * Number(delivered)) /
        Number(res.quote.amountOut) /
        Number(res.quote.amountInUsd)) *
    10_000;
  assert.ok(costBps(res, delivered) >= exact, "the reported cost must never be below the true cost");
  console.log(`  rounding: reported ${costBps(res, delivered)} >= exact ${exact.toFixed(4)}`);
  passed++;
}

console.log(`\n  ${passed} assertions passed`);
