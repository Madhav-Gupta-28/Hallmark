/**
 * Posting a mandate — `readForm` / `openTxs`, plus the
 * preflight checks the reference does not make.
 *
 * One deliberate fix: app.js sets `recipient: ME || VAULT`, i.e. the signed-in
 * account once a wallet is connected. The contract refuses any `open` whose
 * recipient is not the vault itself (contract/src/lib.rs, `open`: "the quote's
 * recipient must be this vault"), so that transfer panics in `ft_on_transfer`
 * and is refunded — after the storage deposit has already gone through. Here
 * the recipient is always the vault.
 */
import {
  near, parseUnits, tokenOf, txOpen, txStorageDeposit, VAULT, view, viewAccount, viewOn,
  type MandateTerms, type Tx,
} from "./hallmark";
import { meta, type TokenTable } from "./tokens";

export const NS_PER_DAY = 86_400_000_000_000n;

/** Deliberately tiny. A first mandate should cost cents, not dollars. */
export const DEFAULTS = {
  origin: "nep141:wrap.near",
  dest: "nep141:usdt.tether-token.near",
  amount: "0.01",
  bps: "300",
  ageS: "300",
  days: "7",
} as const;

export type FormInput = { [K in keyof typeof DEFAULTS]: string };

/** The form's state as a Mandate, or an error saying why not. app.js's `readForm`. */
export function readForm(f: FormInput, table: TokenTable, nowMs: number): { terms: MandateTerms; amount: string } {
  const { origin: origin_asset, dest: destination_asset } = f;
  if (!origin_asset || !destination_asset) throw new Error("pick both assets");
  if (origin_asset === destination_asset)
    throw new Error("the two assets must differ — the contract refuses a mandate that swaps a token for itself");
  if (!destination_asset.startsWith("nep141:")) throw new Error("the contract only accepts a nep141 destination asset");
  const dp = meta(table, origin_asset).dp;
  if (dp === null) throw new Error("this token's decimals are unknown, so an amount cannot be converted exactly");
  const amount = parseUnits(f.amount || "0", dp);
  if (amount === "0") throw new Error("escrow something above zero");
  const bps = Number(f.bps);
  if (!Number.isInteger(bps) || bps < 1 || bps > 10000)
    throw new Error("the cost ceiling must be a whole number of bps between 1 and 10000");
  const ageS = Number(f.ageS);
  if (!Number.isInteger(ageS) || ageS < 1 || ageS > 2_592_000)
    throw new Error("the freshness bound must be between 1 second and 30 days, in seconds");
  const days = Number(f.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("expiry must be a whole number of days");
  return {
    amount,
    terms: {
      origin_asset, destination_asset,
      recipient: VAULT,                         // NOT the signer: see the note at the top
      max_cost_bps: bps,
      max_fill: amount,
      max_quote_age_secs: ageS,
      expiry_ns: String(BigInt(nowMs) * 1_000_000n + BigInt(days) * NS_PER_DAY),
    },
  };
}

/** storage_deposit only if the prepaid balance is below the estimate, then the open. app.js's `openTxs`. */
export function openTxs(terms: MandateTerms, amount: string, prepaid: string, estimate: string): Tx[] {
  const txs: Tx[] = [];
  if (BigInt(prepaid) < BigInt(estimate)) txs.push(txStorageDeposit(estimate));
  txs.push(txOpen(terms, amount));
  return txs;
}

/** What the chain says about this account and this token, before anything is signed. */
export interface Preflight {
  estimate: string;
  prepaid: string;
  /** origin-token balance of the signer, base units */
  tokenBalance: string;
  /** null when the vault has no storage on the origin token: ft_transfer_call to it would fail */
  vaultRegistered: boolean;
  /** NEAR available to the signer for the storage deposit and gas, yocto */
  nearAvailable: string;
}

/** app.js's fallback when the estimate view fails: 1024 bytes at 1e19 yocto. */
export const FALLBACK_ESTIMATE = "10240000000000000000000";

export async function preflight(signer: string, originAsset: string): Promise<Preflight> {
  const token = tokenOf(originAsset);
  const [estimate, prepaid, tokenBalance, vaultStorage, acct] = await Promise.all([
    view<string>("storage_cost_estimate").catch(() => FALLBACK_ESTIMATE),
    view<string>("storage_balance_of", { account_id: signer }),
    viewOn<string>(token, "ft_balance_of", { account_id: signer }),
    viewOn<unknown>(token, "storage_balance_of", { account_id: VAULT }),
    viewAccount(signer),
  ]);
  return {
    estimate, prepaid, tokenBalance,
    vaultRegistered: vaultStorage !== null,
    nearAvailable: spendable(acct),
  };
}

/**
 * NEAR an account can spend, yocto. `amount` is the whole liquid balance, and
 * the account's own storage stake is taken from it, so that part is not
 * spendable.
 */
export function spendable(acct: { amount: string; storage_usage: number }): string {
  const free = BigInt(acct.amount) - BigInt(acct.storage_usage) * 10n ** 19n;
  return (free > 0n ? free : 0n).toString();
}

/** NEAR available to `signer` right now, yocto. */
export async function nearAvailable(signer: string): Promise<string> {
  return spendable(await viewAccount(signer));
}

/** Gas headroom for the batch: 30 + 100 TGas at well under 0.001 NEAR per 100 TGas today. */
export const GAS_HEADROOM = 5n * 10n ** 21n;                // 0.005 NEAR

/** Reasons not to ask for a signature at all. Empty means go. */
export function blockers(p: Preflight, txs: Tx[], amount: string, symbol: string, dp: number | null): string[] {
  const out: string[] = [];
  if (!p.vaultRegistered)
    out.push(`${VAULT} is not storage-registered on this token, so the transfer to it would fail. Pick another token.`);
  if (BigInt(p.tokenBalance) < BigInt(amount)) {
    const have = dp === null ? `${p.tokenBalance} base units` : `${fmt(p.tokenBalance, dp)} ${symbol}`;
    out.push(`you hold ${have}, less than the amount to escrow.`);
  }
  const n = depositBlocker(p.nearAvailable, txs);
  if (n) out.push(n);
  return out;
}

/** Any batch: is there NEAR for its attached deposits plus gas? */
export function depositBlocker(nearAvail: string, txs: Tx[]): string | null {
  const deposit = txs.flatMap((t) => t.actions).reduce((s, a) => s + BigInt(a.deposit), 0n);
  return BigInt(nearAvail) < deposit + GAS_HEADROOM
    ? `this needs about ${near(deposit + GAS_HEADROOM, 4)} NEAR for deposits and gas; ${near(nearAvail, 4)} is available.`
    : null;
}

const fmt = (v: string, dp: number) => {
  const s = BigInt(v).toString().padStart(dp + 1, "0");
  const frac = s.slice(s.length - dp).replace(/0+$/, "");
  return s.slice(0, s.length - dp) + (frac ? "." + frac : "");
};
