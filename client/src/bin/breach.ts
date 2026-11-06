/**
 * Attacking our own vault.
 *
 *   HALLMARK_ACCOUNT=filler.near HALLMARK_KEY=ed25519:... npm run breach -- 1
 *
 * Every guard in this repository that sits *outside* the contract is a
 * courtesy. `fill.ts` prices a quote before it spends anything, and the web app
 * refuses to show a fill it knows the contract will reject — both save the
 * filler a wasted transaction, and neither is the bound. A filler is not
 * obliged to run our code.
 *
 * So this tool is the filler that doesn't. It asks the venue for a quote with a
 * plausible slippage tolerance, delivers exactly the floor that quote
 * guarantees, and sends it. Nothing is softened to make this work: the
 * signature is real, the assets and the recipient match, the quote is seconds
 * old, the fill is inside `max_fill`, and the delivery clears the quote's own
 * floor. Every check but one passes. The one that does not is the ceiling, and
 * it is the only thing standing between the owner and the loss.
 *
 * The attempt is safe to run against a funded mandate. `ft_on_transfer` panics,
 * NEP-141 catches the panic and refunds the delivery in the same transaction
 * (see `receiptFailure`), so a refused fill costs the filler gas and nothing
 * else. That is also why the refusal is worth recording: it is a real
 * transaction on mainnet, not a unit test.
 */
import { canonicalise, costBps, quoteAgeSecs, signatureB58, verifySigner } from "../lib/canonical.ts";
import { getQuote, formatUnits, nearAsset } from "../lib/oneclick.ts";
import { Hallmark, receiptFailure, signer, transferCall, tokenAccount } from "../lib/hallmark.ts";

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const DRY = process.argv.includes("--dry") || !process.env.HALLMARK_KEY;

/**
 * The slippage tolerance to ask the venue for, in bps. The default is not an
 * absurd number: 500 bps is an ordinary setting, the kind a spend policy waves
 * through. The loss it authorises is not ordinary at all.
 */
const SLIPPAGE = Number(process.env.HALLMARK_SLIPPAGE ?? "500");

const id = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? "1");

const hallmark = new Hallmark(VAULT, RPC);
const rec = await hallmark.mandate(id);
if (!rec) throw new Error(`no mandate #${id} on ${VAULT}`);
if (!rec.open) throw new Error(`mandate #${id} is closed`);

const amountIn = min(BigInt(rec.escrow), BigInt(rec.terms.max_fill));
if (amountIn === 0n) throw new Error(`mandate #${id} has nothing left to fill`);

const res = await getQuote({
  originAsset: rec.terms.origin_asset,
  destinationAsset: rec.terms.destination_asset,
  amount: amountIn.toString(),
  recipient: rec.terms.recipient,
  refundTo: rec.terms.recipient,
  slippageTolerance: SLIPPAGE,
});
const canonical = canonicalise(res);
if (!verifySigner(canonical, res.signature)) {
  throw new Error("the venue's signature does not verify — refusing to go on");
}

// Exactly the floor. Not a yocto less, or `UnderDelivered` catches it first and
// the ceiling is never reached — which would prove a different check.
const deliver = BigInt(res.quote.minAmountOut);
const expected = BigInt(res.quote.amountOut);
// Ask the token for its decimals. Assuming six prints wNEAR as
// 13144620232675330.000000, which is not a number anybody can read.
const dest = await nearAsset(rec.terms.destination_asset);

console.log(`
  mandate #${id}   ceiling ${rec.terms.max_cost_bps} bps
  quote             slippageTolerance ${res.quoteRequest.slippageTolerance} bps, signed ${quoteAgeSecs(res)}s ago

  what a spend policy reads
    recipient       ${res.quoteRequest.recipient}        matches the mandate
    assets          ${rec.terms.origin_asset.split(":")[1]} -> ${rec.terms.destination_asset.split(":")[1]}   match the mandate
    size            ${amountIn} <= max_fill ${rec.terms.max_fill}
    slippage        ${res.quoteRequest.slippageTolerance} bps
    verdict         nothing here is out of policy

  what the venue actually signed
    expected out    ${formatUnits(expected, dest.decimals)}   -> ${costBps(res, expected)} bps, inside the ceiling
    GUARANTEED out  ${formatUnits(deliver, dest.decimals)}   -> ${costBps(res, deliver)} bps, ${costBps(res, deliver) > rec.terms.max_cost_bps ? "OVER" : "inside"} the ceiling

  fill.ts would stop here, and so would the web app. This tool does not.
  delivering the floor: ${deliver} base units`);

const verdict = await hallmark.dryCheck(canonical, signatureB58(res), rec.terms, deliver.toString());
console.log(`\n  the contract, asked first:  ${verdict}`);

if (DRY) {
  console.log(`\n  [dry run] set HALLMARK_KEY to send it anyway and record the refusal.\n`);
  process.exit(0);
}

const account = signer(process.env.HALLMARK_ACCOUNT!, process.env.HALLMARK_KEY!, RPC);
const out = await transferCall(
  account,
  tokenAccount(rec.terms.destination_asset),
  VAULT,
  deliver.toString(),
  { action: "fill", mandate_id: id, canonical, signature: signatureB58(res) },
);

const refused = receiptFailure(out);
console.log(`  the contract, told to do it:  ${refused ?? "NOTHING REFUSED IT — the fill landed"}`);
console.log(`  ${out.transaction.hash}\n`);

if (!refused) {
  console.error(`  The ceiling did not hold. That is a finding, not a demo.\n`);
  process.exit(1);
}

// The delivery is back. Prove it rather than assert it: an unrefunded attempt
// looks identical from the outside.
const after = await balance(tokenAccount(rec.terms.destination_asset), process.env.HALLMARK_ACCOUNT!);
console.log(`  the delivery was refunded in the same transaction`);
console.log(`  filler still holds ${formatUnits(after, dest.decimals)} ${dest.symbol}\n`);

async function balance(token: string, accountId: string) {
  return BigInt(await new Hallmark(token, RPC).view<string>("ft_balance_of", { account_id: accountId }));
}

function min(a: bigint, b: bigint) {
  return a < b ? a : b;
}
