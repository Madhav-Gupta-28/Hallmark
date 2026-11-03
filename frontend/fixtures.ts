/**
 * The signed captures, built from contract/fixtures/ at build time — a port of
 * web/assets/mkfixtures.py, producing the same object it writes to
 * web/assets/fixtures.json.
 *
 * Same rule as the reference: no signed quote is ever hand-typed. One wrong
 * byte in the canonical form makes `is_signed` answer false on a genuinely
 * signed quote. Unlike the reference there is no generated file to go stale:
 * vite.config.ts serves this as the `virtual:hallmark-fixtures` module, read
 * from the contract's own fixtures on every dev start and every build.
 *
 * Runs in Node only (vite.config.ts and tests), never in the browser.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";

export const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../contract/fixtures");

export const NAMES = ["honest", "worst", "sandbox"] as const;
export type FixtureName = (typeof NAMES)[number];

export interface Fixture {
  canonical: string;
  signature: string;
  bytes: number;
  quoteHash: string;
  note: string;
}

/** Copied verbatim from web/assets/mkfixtures.py; the parity test holds them equal. */
const NOTE: Record<FixtureName, string> = {
  honest: "A normal quote, for scale: 160 bps guaranteed-worst, 60 bps if honoured in full.",
  worst: "Cryptographically valid, and guarantees a 99.99% loss. slippageTolerance 9999.",
  sandbox: "5 wNEAR to ETH, the fixture the sandbox suite is driven by.",
};

export function buildFixtures(dir = FIXTURES_DIR): Record<FixtureName, Fixture> {
  const out = {} as Record<FixtureName, Fixture>;
  for (const name of NAMES) {
    const canonicalBytes = readFileSync(path.join(dir, `${name}.canonical.json`));
    const sig = readFileSync(path.join(dir, `${name}.sig.bin`));
    if (sig.length !== 64) throw new Error(`${name}: a signature is 64 bytes, got ${sig.length}`);
    const canonical = canonicalBytes.toString("utf8");
    out[name] = {
      canonical,
      signature: bs58.encode(sig),
      bytes: canonicalBytes.length,
      quoteHash: bs58.encode(createHash("sha256").update(canonicalBytes).digest()),
      note: NOTE[name],
    };
  }
  return out;
}

export function fixtureFiles(dir = FIXTURES_DIR): string[] {
  return NAMES.flatMap((n) => [path.join(dir, `${n}.canonical.json`), path.join(dir, `${n}.sig.bin`)]);
}
