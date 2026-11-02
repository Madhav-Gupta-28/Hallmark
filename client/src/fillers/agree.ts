/**
 * Do the three implementations of the invariant agree?
 *
 *   npm run agree
 *
 * There are three places the §2.1 cost is computed: the reference client
 * (`lib/canonical.ts`), an implementation written from the specification alone
 * (`fillers/edge.ts`), and the contract itself. They use different scales,
 * different division orders and different languages. If they ever disagree,
 * one of them is wrong and the bound is not a bound.
 *
 * This sweeps every captured fixture across the whole delivery range and asks
 * the **live mainnet contract** for its answer at each point. No fresh quote is
 * needed, so it works when the venue does not — which is how it got written.
 */
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { costBps, type QuoteResponse } from "../lib/canonical.ts";
import { Hallmark } from "../lib/hallmark.ts";

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const hallmark = new Hallmark(VAULT, process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org");
const dir = new URL("../../../contract/fixtures/", import.meta.url).pathname;

/** The §2.1 invariant, implemented from the spec: 1e18 scale, different order. */
function fromSpec(q: Record<string, string>, delivered: bigint): number {
  const SCALE = 10n ** 18n;
  const usd = (s: string) => {
    const [i, f = ""] = s.split(".");
    if (!/^\d+$/.test(i ?? "")) throw new Error(`bad USD mark "${s}"`);
    return BigInt(i!) * SCALE + BigInt((f + "0".repeat(18)).slice(0, 18));
  };
  const inUsd = usd(q.amountInUsd!);
  const deliveredUsd = (usd(q.amountOutUsd!) * delivered) / BigInt(q.amountOut!);
  if (deliveredUsd >= inUsd) return 0;
  return Number(((inUsd - deliveredUsd) * 10_000n + inUsd - 1n) / inUsd);
}

let checks = 0;
let bad = 0;
console.log(`\n  three implementations of the invariant, against ${VAULT} on mainnet\n`);

for (const name of ["honest", "worst", "sandbox"]) {
  const canonical = readFileSync(dir + name + ".canonical.json", "utf8");
  const q = JSON.parse(canonical) as Record<string, string>;
  const res = {
    quote: q,
    quoteRequest: q,
    signature: bs58.encode(readFileSync(dir + name + ".sig.bin")),
    timestamp: q.timestamp!,
  } as unknown as QuoteResponse;

  const floor = BigInt(q.minAmountOut!);
  const expected = BigInt(q.amountOut!);
  // the floor, the expected fill, 11 points between, and two above
  const points = [
    ...Array.from({ length: 11 }, (_, i) => floor + ((expected - floor) * BigInt(i)) / 10n),
    (expected * 3n) / 2n,
    expected * 2n,
  ];

  let worstGap = 0;
  for (const d of points) {
    const spec = fromSpec(q, d);
    const client = costBps(res, d);
    const chain = await hallmark.view<number>("realised_cost", {
      canonical,
      delivered: d.toString(),
    });
    checks++;
    if (!(spec === client && client === chain)) {
      bad++;
      console.log(`  ${name}  delivered ${d}  spec ${spec}  client ${client}  CHAIN ${chain}  <-- DISAGREE`);
    }
    worstGap = Math.max(worstGap, Math.abs(spec - chain));
  }
  console.log(
    `  ${name.padEnd(8)} ${String(points.length).padStart(2)} delivery points from the signed floor to 2x the expected fill` +
      `   max disagreement ${worstGap} bps`,
  );
}

console.log(`\n  ${checks} comparisons, ${bad} disagreements\n`);
if (bad > 0) process.exit(1);
