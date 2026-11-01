/** Adversarial: bank a signed quote, wait past the mandate's age bound, fill. */
import { canonicalise, signatureB58, verifySigner, quoteAgeSecs, costBps } from "../lib/canonical.ts";
import { getQuote } from "../lib/oneclick.ts";
import { Hallmark, signer, transferCall, tokenAccount } from "../lib/hallmark.ts";

const VAULT = "hallmarkfi.near";
const RPC = "https://rpc.mainnet.near.org";
const h = new Hallmark(VAULT, RPC);
const [[id, m]] = await h.openMandates();
console.log(`\n  mandate #${id}  ceiling ${m.terms.max_cost_bps} bps  age bound ${m.terms.max_quote_age_secs}s  escrow ${m.escrow}`);

const res = await getQuote({
  originAsset: m.terms.origin_asset,
  destinationAsset: m.terms.destination_asset,
  amount: m.escrow,
  recipient: m.terms.recipient,
  refundTo: m.terms.recipient,
  slippageTolerance: 100,
});
const canonical = canonicalise(res);
const signature = signatureB58(res);
const deliver = BigInt(res.quote.amountOut as string);
console.log(`  quote signed  ${res.timestamp}   verifies=${verifySigner(canonical, res.signature)}`);
console.log(`  would cost    ${costBps(res, deliver)} bps at full delivery -> well inside the ceiling`);

const wait = m.terms.max_quote_age_secs + 25;
console.log(`\n  banking it and waiting ${wait}s, so the quote ages past the bound...`);
await new Promise((r) => setTimeout(r, wait * 1000));
console.log(`  quote is now ${quoteAgeSecs(res)}s old; the contract says ${await h.quoteAgeSecs(canonical)}s`);

const before = BigInt(await h.view<string>("get_credit", { account_id: process.env.HALLMARK_ACCOUNT, asset: m.terms.origin_asset }));
const acct = signer(process.env.HALLMARK_ACCOUNT!, process.env.HALLMARK_KEY!, RPC);
try {
  const out = await transferCall(acct, tokenAccount(m.terms.destination_asset), VAULT, deliver.toString(), {
    action: "fill", mandate_id: id, canonical, signature,
  });
  console.log(`\n  *** THE FILL WENT THROUGH: ${out.transaction.hash} — the bound did not hold ***`);
} catch (e: any) {
  const msg = String(e?.message ?? e);
  const hit = /QuoteTooOld[^"\\]*/.exec(msg);
  console.log(`\n  REFUSED on-chain: ${hit ? hit[0] : msg.slice(0, 300)}`);
}
const after = BigInt(await h.view<string>("get_credit", { account_id: process.env.HALLMARK_ACCOUNT, asset: m.terms.origin_asset }));
const rec = await h.mandate(id);
console.log(`  filler credit  ${before} -> ${after}   (must not move)`);
console.log(`  mandate escrow ${rec!.escrow}  fills ${rec!.fills}   (must not move)\n`);
