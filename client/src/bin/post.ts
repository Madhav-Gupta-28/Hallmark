/**
 * Post a mandate.
 *
 *   HALLMARK_ACCOUNT=you.near HALLMARK_KEY=ed25519:... \
 *   npm run post -- USDC NEAR 100 --ceiling 200
 *
 * One transaction: the origin asset goes to the vault with the terms attached.
 * After this the owner signs nothing again — the ceiling is enforced on-chain
 * against whatever any filler brings.
 */
import { nearAsset } from "../lib/oneclick.ts";
import { signer, transferCall, tokenAccount, type MandateTerms } from "../lib/hallmark.ts";

const argv = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : (argv[i + 1] ?? dflt);
};
const [fromSym = "USDC", toSym = "NEAR", humanAmount = "100"] = argv.filter((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--"));

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const accountId = process.env.HALLMARK_ACCOUNT;
const key = process.env.HALLMARK_KEY;
if (!accountId || !key) throw new Error("set HALLMARK_ACCOUNT and HALLMARK_KEY");

const from = await nearAsset(fromSym);
const to = await nearAsset(toSym);
const amount = BigInt(Math.round(Number(humanAmount) * 10 ** from.decimals)).toString();
const days = Number(flag("days", "7"));

const terms: MandateTerms = {
  origin_asset: from.assetId,
  destination_asset: to.assetId,
  // The quote's signed `recipient` must be the vault, or delivery is
  // unverifiable. The contract enforces this when the mandate is opened.
  recipient: VAULT,
  max_cost_bps: Number(flag("ceiling", "200")),
  max_fill: flag("max-fill", amount),
  expiry_ns: ((BigInt(Date.now()) + BigInt(days) * 86_400_000n) * 1_000_000n).toString(),
};

console.log(`
  posting a mandate on ${VAULT}

  ${humanAmount} ${from.symbol} -> ${to.symbol}
  worst acceptable all-in cost   ${terms.max_cost_bps} bps
  largest single fill            ${terms.max_fill}
  expires in                     ${days} days
`);

const account = signer(accountId, key, RPC);
const out = await transferCall(account, tokenAccount(from.assetId), VAULT, amount, {
  action: "open",
  terms,
});
console.log(`  tx  ${out.transaction.hash}`);
console.log(`  see https://nearblocks.io/txns/${out.transaction.hash}\n`);
