/**
 * A patient filler, written from the specification rather than from the
 * reference implementation.
 *
 * Everything here was derived from ARCHITECTURE.md §2.1 (the invariant) and
 * §5.3 (`check`), without reading `bin/fill.ts`. That is the whole point: if an
 * independent reading of the spec computes the same cost the contract computes,
 * on live quotes, then the mechanism is something a stranger can implement — and
 * the agreement is evidence rather than a claim. `--audit` prints both numbers
 * side by side so the agreement is checkable instead of asserted.
 *
 * Strategy: it is not trying to win every mandate. It fills only when the
 * spread it keeps clears a floor it sets for itself, which is what a dealer
 * actually does. Against the reference filler — which always splits the spread —
 * it wins the cheap mandates and declines the thin ones.
 *
 *   HALLMARK_ACCOUNT=you.near HALLMARK_KEY=ed25519:... npm run fill:edge
 *   npm run fill:edge -- --audit     # price everything, send nothing
 */
import { canonicalise, signatureB58, verifySigner, quoteAgeSecs } from "../lib/canonical.ts";
import { getQuote } from "../lib/oneclick.ts";
import { Hallmark, receiptFailure, signer, transferCall, tokenAccount } from "../lib/hallmark.ts";

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const AUDIT = process.argv.includes("--audit") || !process.env.HALLMARK_KEY;

/** The spread this filler insists on keeping, in bps of the input. */
const MIN_EDGE_BPS = Number(process.env.EDGE_MIN_BPS ?? "40");

/**
 * The invariant, implemented from §2.1 directly:
 *
 *     cost = 1 - (amountOutUsd * delivered / amountOut) / amountInUsd
 *
 * Integer-only, and rounding chosen so the answer is never *below* the true
 * cost — §8.1 is explicit that a bound which understates cost is not a bound,
 * so the final division rounds up. A different implementation to the reference
 * one (it scales to 1e18 rather than 1e9, and divides in a different order) and
 * it must still agree to the basis point.
 */
function costBpsFromSpec(q: Record<string, string>, delivered: bigint): number {
  const SCALE = 10n ** 18n;
  const usd = (s: string) => {
    const [i, f = ""] = s.split(".");
    if (!/^\d+$/.test(i ?? "")) throw new Error(`bad USD mark "${s}"`);
    return BigInt(i!) * SCALE + BigInt((f + "0".repeat(18)).slice(0, 18));
  };
  const inUsd = usd(q.amountInUsd!);
  const outUsd = usd(q.amountOutUsd!);
  const amountOut = BigInt(q.amountOut!);
  if (inUsd === 0n || amountOut === 0n) throw new Error("quote has no usable mark");

  // value of what actually arrives, in the same USD scale
  const deliveredUsd = (outUsd * delivered) / amountOut;
  if (deliveredUsd >= inUsd) return 0;
  // (1 - deliveredUsd/inUsd) in bps, rounded up
  const shortfall = (inUsd - deliveredUsd) * 10_000n;
  return Number((shortfall + inUsd - 1n) / inUsd);
}

/** What this filler keeps if it delivers `delivered`, in bps of the input. */
function edgeBps(q: Record<string, string>, delivered: bigint): number {
  return costBpsFromSpec(q, delivered) - costBpsFromSpec(q, BigInt(q.amountOut!));
}

const hallmark = new Hallmark(VAULT, RPC);
const mandates = await hallmark.openMandates();
console.log(
  `\n  edge filler on ${VAULT} — needs ${MIN_EDGE_BPS} bps of spread` +
    `${AUDIT ? "   [audit only, nothing sent]" : ""}\n`,
);

for (const [id, m] of mandates) {
  const label = `  #${id} ${m.terms.origin_asset.split(":")[1]} -> ${m.terms.destination_asset.split(":")[1]}`;
  const amountIn = min(BigInt(m.escrow), BigInt(m.terms.max_fill));
  if (amountIn === 0n) {
    console.log(`${label}  nothing left to fill`);
    continue;
  }

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

  // Refuse to act on a quote the contract's own signer did not sign. A filler
  // that skips this wastes a transaction; one that skips it and is wrong about
  // canonical form wastes every transaction.
  if (!verifySigner(canonical, res.signature)) {
    console.log(`${label}  REFUSING to act: the quote does not verify`);
    continue;
  }
  const age = quoteAgeSecs(res);
  if (age > m.terms.max_quote_age_secs) {
    console.log(`${label}  skip: quote is ${age}s old, mandate allows ${m.terms.max_quote_age_secs}s`);
    continue;
  }

  // Deliver the least that clears both the owner's ceiling and our own floor.
  // Search from the venue's floor upward: more delivered is cheaper for the
  // owner and thinner for us.
  const floor = BigInt(q.minAmountOut!);
  const expected = BigInt(q.amountOut!);
  let chosen: bigint | null = null;
  for (let step = 0; step <= 20; step++) {
    const d = floor + ((expected - floor) * BigInt(step)) / 20n;
    if (costBpsFromSpec(q, d) <= m.terms.max_cost_bps && edgeBps(q, d) >= MIN_EDGE_BPS) {
      chosen = d;
      break;
    }
  }

  // The independent implementation, checked against the contract's own, on a
  // live quote. This is the cross-check the filler exists for.
  const probe = chosen ?? expected;
  const mine = costBpsFromSpec(q, probe);
  const theirs = await hallmark.view<number>("realised_cost", {
    canonical,
    delivered: probe.toString(),
  });
  const agree = mine === theirs ? "agree" : `*** DISAGREE: spec says ${mine}, contract says ${theirs} ***`;
  console.log(`${label}  cost ${mine} bps / ceiling ${m.terms.max_cost_bps}  edge ${edgeBps(q, probe)} bps  [${agree}]`);
  if (mine !== theirs) process.exitCode = 1;

  if (chosen === null) {
    console.log(`       pass: no delivery clears both a ${m.terms.max_cost_bps} bps ceiling and ${MIN_EDGE_BPS} bps of edge`);
    continue;
  }
  if (AUDIT) continue;

  const account = signer(process.env.HALLMARK_ACCOUNT!, process.env.HALLMARK_KEY!, RPC);
  const out = await transferCall(
    account,
    tokenAccount(m.terms.destination_asset),
    VAULT,
    chosen.toString(),
    { action: "fill", mandate_id: id, canonical, signature: signatureB58(res) },
  );
  const refused = receiptFailure(out);
  console.log(refused ? `       REFUSED: ${refused}` : `       filled:  ${out.transaction.hash}`);
}
console.log();

function min(a: bigint, b: bigint) {
  return a < b ? a : b;
}
