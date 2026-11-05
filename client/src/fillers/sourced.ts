/**
 * The filler whose inventory is somewhere else.
 *
 *   npm run fill:sourced -- --from base            # price the whole route, spend nothing
 *   SOURCE_KEY=0x… HALLMARK_KEY=ed25519:… npm run fill:sourced -- --from base --go
 *
 * A Hallmark mandate is NEAR-local by construction. The contract requires a
 * `nep141:` asset on both legs because it has to watch the delivery arrive
 * before it credits anything — that is §2.4, and it is the reason nobody here
 * ever holds a counterparty's funds. But it is a statement about where the
 * *bound* lives, not about where the *liquidity* lives.
 *
 * This filler holds USDC on Base and has no NEAR inventory at all. It reads an
 * open NEAR mandate, prices what the delivery has to be, sources exactly that
 * much through 1Click, waits for it to land on NEAR, and then fills. One
 * command, two chains, one ceiling — and the ceiling is still enforced on NEAR
 * against the venue's own signature, because that is the only place it can be.
 *
 * Four ways this can cost the filler money, all of them on the filler:
 *
 *  1. `depositAddress` is not inside the venue's signed payload. The amounts
 *     are signed; the address you are told to pay is advice (§2.4). So the
 *     sourcing leg is trusted and the fill leg is not — which is the right way
 *     round, because the sourcing leg risks the filler's own inventory and the
 *     fill leg risks the owner's.
 *  2. The sourcing leg can be refunded. Then the filler has its USDC back,
 *     minus the refund fee, and the mandate is untouched.
 *  3. The price can move between sourcing and filling. The filler carries that;
 *     the owner's ceiling does not move.
 *  4. The fill can still be refused on arrival. Then the USDT sits in the
 *     filler's NEAR account and the next run uses it.
 *
 * Nowhere in that list is the owner.
 */
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits as viemFormat } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, arbitrum } from "viem/chains";

import { canonicalise, costBps, quoteAgeSecs, signatureB58, verifySigner } from "../lib/canonical.ts";
import { getQuote, getStatus, hashes, formatUnits } from "../lib/oneclick.ts";
import {
  Hallmark,
  receiptFailure,
  signer,
  transferCall,
  tokenAccount,
} from "../lib/hallmark.ts";

/** Where a filler can keep inventory and still serve a NEAR mandate. */
const SOURCES = {
  base: {
    chain: base,
    rpc: "https://mainnet.base.org",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
    asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    symbol: "USDC",
    decimals: 6,
  },
  arbitrum: {
    chain: arbitrum,
    rpc: "https://arb1.arbitrum.io/rpc",
    token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const,
    asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    symbol: "USDC",
    decimals: 6,
  },
} as const;

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const GO = process.argv.includes("--go");
const NEAR_ACCOUNT = process.env.HALLMARK_ACCOUNT ?? "";

const which = (argv(["--from"]) ?? "base") as keyof typeof SOURCES;
const src = SOURCES[which];
if (!src) throw new Error(`unknown source "${which}". Known: ${Object.keys(SOURCES).join(" ")}`);

const hallmark = new Hallmark(VAULT, RPC);
const id = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? "1");
const rec = await hallmark.mandate(id);
if (!rec) throw new Error(`no mandate #${id} on ${VAULT}`);
if (!rec.open) throw new Error(`mandate #${id} is closed`);

const destTok = tokenAccount(rec.terms.destination_asset);
const destSym = (destTok.split(".")[0] ?? destTok).toUpperCase();
const amountIn = min(BigInt(rec.escrow), BigInt(rec.terms.max_fill));
if (amountIn === 0n) throw new Error(`mandate #${id} has nothing left to fill`);

console.log(`
  mandate #${id} on ${VAULT}
    wants            ${rec.terms.origin_asset.split(":")[1]} -> ${destTok}
    ceiling          ${rec.terms.max_cost_bps} bps
    this fill        ${amountIn} origin base units

  the filler's inventory is on ${which}, not on NEAR`);

// ---------------------------------------------------------------- 1. the price
// What has to arrive in the vault, priced against a live signed NEAR-leg quote.
// Sized first, sourced second: there is no point buying inventory until the
// owner's own ceiling says what the delivery has to be.
const nearLeg = await getQuote({
  originAsset: rec.terms.origin_asset,
  destinationAsset: rec.terms.destination_asset,
  amount: amountIn.toString(),
  recipient: rec.terms.recipient,
  refundTo: rec.terms.recipient,
  slippageTolerance: 100,
});
if (!verifySigner(canonicalise(nearLeg), nearLeg.signature)) {
  throw new Error("the NEAR-leg quote does not verify — refusing to go on");
}
const floor = BigInt(nearLeg.quote.minAmountOut);
const expected = BigInt(nearLeg.quote.amountOut);
const keep = Number(process.env.HALLMARK_KEEP ?? "0.5");
const deliver = floor + ((expected - floor) * BigInt(Math.round(keep * 1000))) / 1000n;
const cost = costBps(nearLeg, deliver);

console.log(`
  1. what the delivery has to be
     expected out    ${formatUnits(expected, 6)} ${destSym}
     signed floor    ${formatUnits(floor, 6)} ${destSym}
     we will deliver ${formatUnits(deliver, 6)} ${destSym}   -> ${cost} bps, ceiling ${rec.terms.max_cost_bps}`);
if (cost > rec.terms.max_cost_bps) {
  console.log(`\n  this mandate cannot be served at this price. Nothing sourced, nothing spent.\n`);
  process.exit(0);
}

// What is already on NEAR counts. A filler that re-sources inventory it already
// holds pays the bridge twice for nothing.
const have = BigInt(await balance(destTok, NEAR_ACCOUNT || "x.near").catch(() => "0"));
const need = deliver > have ? deliver - have : 0n;
console.log(`     already on NEAR ${formatUnits(have, 6)} ${destSym}   -> must source ${formatUnits(need, 6)}`);

// ------------------------------------------------------------- 2. the sourcing
// Overshoot deliberately, by more than the bridge's own slippage. 1Click prices
// EXACT_INPUT, so asking for exactly `need` of output and getting one base unit
// less leaves the fill unfundable after a bridge has already run. The bridge
// also takes tens of seconds, and the fill is repriced against a *fresh* quote
// when it lands (§2.10) — so the delivery the fill needs is not quite the one
// priced in step 1. 5% covers both and costs a fraction of a cent at these
// sizes; whatever is left over stays as inventory for the next fill.
const sourceAmount = need === 0n ? 0n : (need * 105n) / 100n;
let sourceQuote: Awaited<ReturnType<typeof getQuote>> | null = null;

if (need > 0n) {
  sourceQuote = await getQuote({
    originAsset: src.asset,
    destinationAsset: rec.terms.destination_asset,
    amount: sourceAmount.toString(),
    recipient: NEAR_ACCOUNT || VAULT,
    refundTo: evmAddress() ?? "0x0000000000000000000000000000000000000000",
    dry: !GO,
  });
  const q = sourceQuote.quote;
  console.log(`
  2. sourcing ${formatUnits(BigInt(q.amountIn), src.decimals)} ${src.symbol} on ${which} -> ${formatUnits(BigInt(q.amountOut), 6)} ${destSym} on NEAR
     all-in          $${q.amountInUsd} -> $${q.amountOutUsd}   ${sourceBps(q)} bps
     eta             ${q.timeEstimate}s
     deposit         ${q.depositAddress ?? "(not requested — this is a dry run)"}`);
}

if (!GO) {
  console.log(`
  3. the fill would be sent from ${NEAR_ACCOUNT || "(set HALLMARK_ACCOUNT)"}

  Nothing was spent. Add --go, SOURCE_KEY (the ${which} wallet) and HALLMARK_KEY
  to run the route for real.
`);
  process.exit(0);
}

if (!process.env.SOURCE_KEY) throw new Error("--go needs SOURCE_KEY: the key holding inventory on " + which);
if (!process.env.HALLMARK_KEY) throw new Error("--go needs HALLMARK_KEY: the NEAR account that delivers");
if (!NEAR_ACCOUNT) throw new Error("--go needs HALLMARK_ACCOUNT");

if (sourceQuote) {
  const dep = sourceQuote.quote.depositAddress as `0x${string}`;
  const account = privateKeyToAccount(process.env.SOURCE_KEY as `0x${string}`);
  const pub = createPublicClient({ chain: src.chain, transport: http(src.rpc) });
  const wallet = createWalletClient({ account, chain: src.chain, transport: http(src.rpc) });

  const held = await pub.readContract({
    address: src.token, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
  });
  const gas = await pub.getBalance({ address: account.address });
  console.log(`
  ${which} wallet ${account.address}
     holds           ${viemFormat(held, src.decimals)} ${src.symbol}, ${viemFormat(gas, 18)} ETH for gas`);
  if (held < BigInt(sourceQuote.quote.amountIn)) {
    throw new Error(
      `not enough ${src.symbol} on ${which}: holds ${viemFormat(held, src.decimals)}, ` +
        `needs ${formatUnits(BigInt(sourceQuote.quote.amountIn), src.decimals)}`,
    );
  }

  const tx = await wallet.writeContract({
    address: src.token, abi: erc20Abi, functionName: "transfer",
    args: [dep, BigInt(sourceQuote.quote.amountIn)],
  });
  console.log(`     sent            ${tx}`);
  await pub.waitForTransactionReceipt({ hash: tx });
  console.log(`     confirmed on ${which}`);

  // Poll the venue, then check the chain. The API saying SUCCESS and the tokens
  // being in the account are two different claims, and only one of them pays
  // for a fill.
  const landed = await waitForSwap(dep);
  console.log(`     1Click          ${landed.status}` + (hashes(landed.swapDetails.nearTxHashes).length
    ? `  near ${hashes(landed.swapDetails.nearTxHashes)[0]}` : ""));
  if (landed.status !== "SUCCESS") {
    throw new Error(
      `the sourcing leg ended ${landed.status}` +
        (landed.swapDetails.refundReason ? ` (${landed.swapDetails.refundReason})` : "") +
        `. The ${src.symbol} is the filler's problem; mandate #${id} is untouched.`,
    );
  }
  const nowHave = BigInt(await balance(destTok, NEAR_ACCOUNT));
  console.log(`     on NEAR         ${formatUnits(nowHave, 6)} ${destSym}  (was ${formatUnits(have, 6)})`);
  if (nowHave < deliver) {
    throw new Error(`sourced, but ${formatUnits(nowHave, 6)} is still short of ${formatUnits(deliver, 6)}`);
  }
}

// ----------------------------------------------------------------- 3. the fill
// A fresh quote. The one priced in step 1 is minutes old by now and the mandate
// bounds how stale a quote may be — banking one is the attack that bound exists
// for (§2.10), and the bridge wait is exactly how a filler would come to hold a
// stale one honestly.
const fillLeg = await getQuote({
  originAsset: rec.terms.origin_asset,
  destinationAsset: rec.terms.destination_asset,
  amount: amountIn.toString(),
  recipient: rec.terms.recipient,
  refundTo: rec.terms.recipient,
  slippageTolerance: 100,
});
const canonical = canonicalise(fillLeg);
if (!verifySigner(canonical, fillLeg.signature)) throw new Error("the fill-leg quote does not verify");

const f2 = BigInt(fillLeg.quote.minAmountOut);
const e2 = BigInt(fillLeg.quote.amountOut);
const deliver2 = f2 + ((e2 - f2) * BigInt(Math.round(keep * 1000))) / 1000n;
const cost2 = costBps(fillLeg, deliver2);
const verdict = await hallmark.dryCheck(canonical, signatureB58(fillLeg), rec.terms, deliver2.toString());
console.log(`
  3. filling with inventory sourced on ${which}
     fresh quote     ${quoteAgeSecs(fillLeg)}s old, delivering ${formatUnits(deliver2, 6)} ${destSym} -> ${cost2} bps
     the contract    ${verdict}`);
if (!verdict.startsWith("ALLOWED")) throw new Error(`the contract would refuse this fill: ${verdict}`);

const account = signer(NEAR_ACCOUNT, process.env.HALLMARK_KEY!, RPC);
const out = await transferCall(account, destTok, VAULT, deliver2.toString(), {
  action: "fill", mandate_id: id, canonical, signature: signatureB58(fillLeg),
});
const refused = receiptFailure(out);
if (refused) {
  console.log(`     REFUSED         ${refused}`);
  console.log(`     ${out.transaction.hash}  (the delivery was refunded)\n`);
  process.exit(1);
}
console.log(`     filled          ${out.transaction.hash}`);
console.log(`
  ${src.symbol} on ${which} became a filled mandate on NEAR at ${cost2} bps against a ${rec.terms.max_cost_bps} bps ceiling.
  The ceiling was enforced on NEAR, against the venue's own signature, where it
  is the only thing that can be. The liquidity came from somewhere else.
`);

// ------------------------------------------------------------------- the plumbing

async function waitForSwap(dep: string, timeoutMs = 300_000) {
  const until = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    const s = await getStatus(dep);
    if (s.status !== last) {
      console.log(`     ${new Date().toISOString().slice(11, 19)}        ${s.status}`);
      last = s.status;
    }
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(s.status)) return s;
    if (Date.now() > until) {
      throw new Error(`the sourcing leg is still ${s.status} after ${timeoutMs / 1000}s — check ${dep}`);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

function balance(token: string, accountId: string) {
  return new Hallmark(token, RPC).view<string>("ft_balance_of", { account_id: accountId });
}

/** The all-in cost of the sourcing leg, in bps, from the venue's own USD marks. */
function sourceBps(q: { amountInUsd: string; amountOutUsd: string }) {
  const inUsd = Number(q.amountInUsd);
  if (inUsd === 0) return 0;
  return Math.max(0, Math.round(((inUsd - Number(q.amountOutUsd)) / inUsd) * 10_000));
}

function evmAddress() {
  if (!process.env.SOURCE_KEY) return null;
  return privateKeyToAccount(process.env.SOURCE_KEY as `0x${string}`).address;
}

function argv(flags: string[]) {
  for (const f of flags) {
    const i = process.argv.indexOf(f);
    if (i >= 0) return process.argv[i + 1];
  }
  return undefined;
}

function min(a: bigint, b: bigint) {
  return a < b ? a : b;
}
