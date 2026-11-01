/**
 * Post a mandate.
 *
 *   HALLMARK_ACCOUNT=you.near HALLMARK_KEY=ed25519:... \
 *   npm run post -- USDC NEAR 100 --ceiling 200
 *
 * Two transactions, then nothing: prepay the storage the mandate record uses,
 * then send the origin asset to the vault with the terms attached. After that
 * the owner signs nothing again — the ceiling is enforced on-chain against
 * whatever any filler brings.
 */
import { nearAsset, parseUnits } from "../lib/oneclick.ts";
import { Hallmark, signer, transferCall, tokenAccount, type MandateTerms } from "../lib/hallmark.ts";

const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const accountId = process.env.HALLMARK_ACCOUNT;
const key = process.env.HALLMARK_KEY;
if (!accountId || !key) throw new Error("set HALLMARK_ACCOUNT and HALLMARK_KEY");

/**
 * Flags first, then whatever is left over is positional. The obvious
 * `argv.filter(...)` version is wrong: `indexOf` finds the *first* match, so a
 * flag value that happens to equal a positional one is kept or dropped by
 * accident.
 */
const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith("--")) flags.set(a.slice(2), argv[++i] ?? "");
  else positional.push(a);
}
const flag = (name: string, dflt: string) => flags.get(name) ?? dflt;
const [fromSym = "USDC", toSym = "NEAR", humanAmount = "100"] = positional;

const from = await nearAsset(fromSym);
const to = await nearAsset(toSym);
const amount = parseUnits(humanAmount, from.decimals).toString();
const days = Number(flag("days", "7"));

const terms: MandateTerms = {
  origin_asset: from.assetId,
  destination_asset: to.assetId,
  // The quote's signed `recipient` must be the vault, or delivery is
  // unverifiable. The contract enforces this when the mandate is opened.
  recipient: VAULT,
  max_cost_bps: Number(flag("ceiling", "200")),
  max_fill: flag("max-fill", amount),
  // Five minutes. The cost ceiling is denominated in the USD marks the venue
  // signed, so it only means something while those marks are current — and the
  // *filler* chooses the quote's `deadline`, so the deadline cannot bound this
  // (ARCHITECTURE.md §2.10).
  max_quote_age_secs: Number(flag("max-quote-age", "300")),
  expiry_ns: ((BigInt(Date.now()) + BigInt(days) * 86_400_000n) * 1_000_000n).toString(),
};

const hallmark = new Hallmark(VAULT, RPC);
const account = signer(accountId, key, RPC);

console.log(`
  posting a mandate on ${VAULT}

  ${humanAmount} ${from.symbol} -> ${to.symbol}
  worst acceptable all-in cost   ${terms.max_cost_bps} bps
  largest single fill            ${terms.max_fill}
  quotes must be newer than      ${terms.max_quote_age_secs} s
  expires in                     ${days} days
`);

// 1. Prepay the storage this record will occupy. The vault does not subsidise
//    state anyone can create (§2.11). One deposit covers many mandates, so this
//    is skipped when the balance already covers it.
const need = BigInt(await hallmark.storageCostEstimate());
const have = BigInt(await hallmark.storageBalanceOf(accountId));
if (have < need) {
  const top = need - have;
  console.log(`  prepaying storage             ${(Number(top) / 1e24).toFixed(5)} NEAR`);
  const dep = await account.callFunctionRaw({
    contractId: VAULT,
    methodName: "storage_deposit",
    args: {},
    gas: 30_000_000_000_000n,
    deposit: top,
  });
  console.log(`  tx  ${dep.transaction.hash}`);
} else {
  console.log(`  storage already prepaid       ${(Number(have) / 1e24).toFixed(5)} NEAR`);
}

// 2. The mandate itself.
const out = await transferCall(account, tokenAccount(from.assetId), VAULT, amount, {
  action: "open",
  terms,
});
console.log(`  tx  ${out.transaction.hash}`);
console.log(`  see https://nearblocks.io/txns/${out.transaction.hash}\n`);
