/**
 * What does the venue actually guarantee?
 *
 *   npm run bound -- USDC NEAR 100
 *
 * Fetches a live signed quote, verifies nothing is missing from it, and prints
 * the bound the contract would enforce. Needs no key, no funds and no
 * deployment: `dry: true` quotes are free and commit nothing.
 */
import {
  canonicalise,
  quoteHash,
  worstCostBps,
  costBps,
  signatureB58,
  verifySigner,
  QUOTE_SIGNER,
} from "../lib/canonical.ts";
import { getQuote, nearAsset } from "../lib/oneclick.ts";

const [fromSym = "USDC", toSym = "NEAR", humanAmount = "100"] = process.argv.slice(2);

const from = await nearAsset(fromSym);
const to = await nearAsset(toSym);
const amount = (BigInt(Math.round(Number(humanAmount) * 1e6)) * 10n ** BigInt(from.decimals)) / 10n ** 6n;

const res = await getQuote({
  originAsset: from.assetId,
  destinationAsset: to.assetId,
  amount: amount.toString(),
  // 1Click refuses a quote whose recipient is not an existing on-chain
  // account, so this names a real one (ARCHITECTURE.md §3.11).
  recipient: process.env.HALLMARK_VAULT ?? "hallmark.near",
  refundTo: process.env.HALLMARK_VAULT ?? "hallmark.near",
});

const canonical = canonicalise(res);
const expected = BigInt(res.quote.amountOut);
const floor = BigInt(res.quote.minAmountOut);
const fmt = (v: bigint, d: number) => (Number(v) / 10 ** d).toFixed(6);

console.log(`
  ${humanAmount} ${from.symbol} -> ${to.symbol}

  in                 $${res.quote.amountInUsd}
  out                $${res.quote.amountOutUsd}      ${fmt(expected, to.decimals)} ${to.symbol}
  guaranteed floor                     ${fmt(floor, to.decimals)} ${to.symbol}
  slippageTolerance  ${res.quoteRequest.slippageTolerance} bps   <- what a policy engine reads

  realised cost if the fill is honoured in full   ${costBps(res, expected)} bps
  GUARANTEED-WORST all-in cost                    ${worstCostBps(res)} bps   <- what the venue actually promised

  quote hash         ${quoteHash(canonical)}
  canonical bytes    ${Buffer.byteLength(canonical, "utf8")}
  signature valid    ${verifySigner(canonical, res.signature)}  (against ${QUOTE_SIGNER.slice(0, 20)}...)
`);

if (!verifySigner(canonical, res.signature)) {
  console.error(
    `  The venue signed this quote with a key the contract does not trust.\n` +
      `  Either canonicalisation drifted, or 1Click rotated its signer.\n`,
  );
  process.exit(1);
}

if (worstCostBps(res) > 300) {
  console.log(`  A mandate with a 300 bps ceiling would REFUSE this quote on-chain.\n`);
}

// Everything a fill needs, ready to paste into a contract call.
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ canonical, signature: signatureB58(res) }, null, 2));
}
