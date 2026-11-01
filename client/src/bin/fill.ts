/**
 * The reference filler.
 *
 *   HALLMARK_ACCOUNT=filler.near HALLMARK_KEY=ed25519:... npm run fill
 *
 * Reads open mandates, prices each one against a live signed quote, and fills
 * the ones it can serve inside the owner's ceiling.
 *
 * The filler delivers the output *first* and is credited the input in the same
 * transaction, so it needs destination-asset inventory — see ARCHITECTURE.md
 * §6.4. There is no fee field anywhere: the filler's pay is the spread between
 * what it can source the output for and what it delivers.
 */
import { canonicalise, costBps, quoteAgeSecs, signatureB58, verifySigner } from "../lib/canonical.ts";
import { getQuote } from "../lib/oneclick.ts";
import {
  Hallmark,
  signer,
  transferCall,
  tokenAccount,
  type MandateRecord,
} from "../lib/hallmark.ts";

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const DRY = process.argv.includes("--dry") || !process.env.HALLMARK_KEY;

/** How much of the spread to keep. 0 delivers the floor; 1 delivers it all. */
const KEEP = Number(process.env.HALLMARK_KEEP ?? "0.5");

const hallmark = new Hallmark(VAULT, RPC);
const mandates = await hallmark.openMandates();
console.log(`\n  ${mandates.length} open mandate(s) on ${VAULT}${DRY ? "   [dry run]" : ""}\n`);

for (const [id, m] of mandates) {
  const label = `  #${id} ${m.terms.origin_asset.split(":")[1]} -> ${m.terms.destination_asset.split(":")[1]}`;
  const amountIn = min(BigInt(m.escrow), BigInt(m.terms.max_fill));
  if (amountIn === 0n) {
    console.log(`${label}  nothing left to fill`);
    continue;
  }

  // A quote whose recipient is the vault, so the contract can match it.
  const res = await getQuote({
    originAsset: m.terms.origin_asset,
    destinationAsset: m.terms.destination_asset,
    amount: amountIn.toString(),
    recipient: m.terms.recipient,
    refundTo: m.terms.recipient,
    slippageTolerance: 100,
  });
  const canonical = canonicalise(res);
  if (!verifySigner(canonical, res.signature)) {
    console.log(`${label}  REFUSING to act: the quote does not verify`);
    continue;
  }

  const floor = BigInt(res.quote.minAmountOut);
  const expected = BigInt(res.quote.amountOut);
  // Deliver somewhere between the venue's floor and its expected fill. The more
  // we deliver, the cheaper for the owner and the thinner our spread.
  const deliver = floor + ((expected - floor) * BigInt(Math.round(KEEP * 1000))) / 1000n;

  const cost = costBps(res, deliver);
  if (cost > m.terms.max_cost_bps) {
    console.log(
      `${label}  skip: ${cost} bps > ${m.terms.max_cost_bps} bps ceiling` +
        `  (best possible here is ${costBps(res, expected)} bps)`,
    );
    continue;
  }

  // Ask the contract itself before spending anything.
  // A fresh quote, every time. The mandate bounds how stale one may be, and a
  // filler that banks quotes to exercise later is the attack that bound exists
  // for (§2.10) — so there is nothing to gain by holding one.
  const age = quoteAgeSecs(res);
  if (age > m.terms.max_quote_age_secs) {
    console.log(`${label}  skip: quote is ${age}s old, mandate allows ${m.terms.max_quote_age_secs}s`);
    continue;
  }

  const verdict = await hallmark.dryCheck(canonical, signatureB58(res), m.terms, deliver.toString());
  console.log(`${label}  ${cost} bps <= ${m.terms.max_cost_bps} bps  (quote ${age}s old)  ${verdict}`);
  if (!verdict.startsWith("ALLOWED") || DRY) continue;

  const account = signer(process.env.HALLMARK_ACCOUNT!, process.env.HALLMARK_KEY!, RPC);
  const out = await transferCall(
    account,
    tokenAccount(m.terms.destination_asset),
    VAULT,
    deliver.toString(),
    { action: "fill", mandate_id: id, canonical, signature: signatureB58(res) },
  );
  console.log(`       filled: ${out.transaction.hash}`);
}
console.log();

function min(a: bigint, b: bigint) {
  return a < b ? a : b;
}
