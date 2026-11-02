/**
 * All three fillers price the same mandate, side by side. Sends nothing.
 *
 *   npm run race
 *
 * The point is not that one wins. It is that three independently-written agents
 * — one of them derived from NEAR's own official Intents skill, one written from
 * the specification without reading the others — look at the same mandate, the
 * same live signed quote, and land inside the same bound while disagreeing about
 * strategy. The owner's ceiling is enforced on all of them identically, which is
 * the whole claim: the mandate does not care who fills it.
 *
 * It also cross-checks the arithmetic three ways: the reference client, an
 * independent implementation written from §2.1, and the contract itself. If
 * those three ever disagree, this exits non-zero.
 */
import { canonicalise, costBps, quoteAgeSecs, verifySigner } from "../lib/canonical.ts";
import { getQuote } from "../lib/oneclick.ts";
import { Hallmark, type MandateRecord } from "../lib/hallmark.ts";

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const MIN_EDGE_BPS = Number(process.env.EDGE_MIN_BPS ?? "40");

/** The §2.1 invariant, implemented independently of `lib/canonical.ts`. */
function costBpsFromSpec(q: Record<string, string>, delivered: bigint): number {
  const SCALE = 10n ** 18n;
  const usd = (s: string) => {
    const [i, f = ""] = s.split(".");
    return BigInt(i!) * SCALE + BigInt((f + "0".repeat(18)).slice(0, 18));
  };
  const inUsd = usd(q.amountInUsd!);
  const deliveredUsd = (usd(q.amountOutUsd!) * delivered) / BigInt(q.amountOut!);
  if (deliveredUsd >= inUsd) return 0;
  return Number(((inUsd - deliveredUsd) * 10_000n + inUsd - 1n) / inUsd);
}

const hallmark = new Hallmark(VAULT, RPC);
const mandates = await hallmark.openMandates();
if (mandates.length === 0) {
  console.log(`\n  no open mandates on ${VAULT} to race for\n`);
  process.exit(0);
}

for (const [id, m] of mandates as [number, MandateRecord][]) {
  const amountIn = BigInt(m.escrow) < BigInt(m.terms.max_fill) ? BigInt(m.escrow) : BigInt(m.terms.max_fill);
  if (amountIn === 0n) continue;

  const res = await getQuote({
    originAsset: m.terms.origin_asset,
    destinationAsset: m.terms.destination_asset,
    amount: amountIn.toString(),
    recipient: m.terms.recipient,
    refundTo: m.terms.recipient,
    slippageTolerance: 100,
  });
  const canonical = canonicalise(res);
  const q = JSON.parse(canonical) as Record<string, string>;
  const floor = BigInt(q.minAmountOut!);
  const expected = BigInt(q.amountOut!);
  const dp = 1e6; // USDT; display only

  console.log(`
  mandate #${id}   ${m.terms.origin_asset.split(":")[1]} -> ${m.terms.destination_asset.split(":")[1]}
  ceiling ${m.terms.max_cost_bps} bps   quotes must be newer than ${m.terms.max_quote_age_secs}s
  live quote: signed ${quoteAgeSecs(res)}s ago, verifies ${verifySigner(canonical, res.signature)}
  the venue's floor ${(Number(floor) / dp).toFixed(6)}   its expected fill ${(Number(expected) / dp).toFixed(6)}
`);

  // each filler's own delivery policy
  const reference = floor + (expected - floor) / 2n;
  let edge: bigint | null = null;
  for (let step = 0; step <= 20; step++) {
    const d = floor + ((expected - floor) * BigInt(step)) / 20n;
    const c = costBpsFromSpec(q, d);
    if (c <= m.terms.max_cost_bps && c - costBpsFromSpec(q, expected) >= MIN_EDGE_BPS) {
      edge = d;
      break;
    }
  }
  const adapted = expected;

  const rows: [string, bigint | null, string][] = [
    ["fill.ts (reference)", reference, "splits the spread"],
    ["edge.ts (independent)", edge, `needs ${MIN_EDGE_BPS} bps of edge`],
    ["adapted.ts (official agent)", adapted, "delivers the expected fill"],
  ];

  let disagreement = false;
  for (const [name, deliver, note] of rows) {
    if (deliver === null) {
      console.log(`  ${name.padEnd(30)} PASSES          ${note}`);
      continue;
    }
    const mine = costBpsFromSpec(q, deliver);
    const theirs = costBps(res, deliver);
    const chain = await hallmark.view<number>("realised_cost", {
      canonical,
      delivered: deliver.toString(),
    });
    const ok = mine === theirs && theirs === chain;
    if (!ok) disagreement = true;
    const verdict = chain <= m.terms.max_cost_bps ? "within bound" : "REFUSED by the ceiling";
    console.log(
      `  ${name.padEnd(30)} ${String(chain).padStart(4)} bps  ` +
        `delivers ${(Number(deliver) / dp).toFixed(6)}  ${verdict.padEnd(22)} ${note}` +
        (ok ? "" : `   *** spec ${mine} / client ${theirs} / chain ${chain} ***`),
    );
  }

  const best = rows
    .filter(([, d]) => d !== null)
    .sort((a, b) => Number(b[1]! - a[1]!))[0];
  console.log(`
  cheapest for the owner: ${best?.[0]} — delivering more costs the owner less and
  earns the filler less, which is competition acting on the right variable (§2.5).
  First-come-first-served means whoever lands first wins, not whoever is cheapest;
  that limit is stated in §2.9 and an auction window is the documented next step.

  all three implementations of the invariant agree: ${disagreement ? "NO" : "yes"}
`);
  if (disagreement) process.exitCode = 1;
}
