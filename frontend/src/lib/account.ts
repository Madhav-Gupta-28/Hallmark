/**
 * Everything the vault holds for, and owes, one account — read from the
 * chain, all at one block.
 *
 * The contract has no owner index and no "list my credits" view, so:
 *   - mandates: `get_mandate(1..mandate_count)`, keeping the owner's. Ids are
 *     never reused and a reaped record reads as null, so this finds every
 *     mandate the account still has a record for — open or closed.
 *   - credits: `get_credit(account, asset)` for every NEAR asset 1Click lists,
 *     plus the vault's known pair and the assets of the account's own
 *     mandates (which 1Click might not list). A withdrawn credit is removed,
 *     so non-zero is exactly "has a credit".
 * Both cost one view call per id or asset. Every read is pinned to the block
 * `mandate_count` was read at, so the picture is consistent while it loads.
 */
import {
  txCancel, txFund, txReap, txStorageDeposit, txStorageWithdraw, txWithdraw, viewAt,
  type MandateRecord, type Tx,
} from "./hallmark";

export type Reader = <T>(method: string, args: Record<string, unknown>, block?: number) =>
  Promise<{ value: T; blockHeight: number }>;

const read: Reader = (m, a, b) => viewAt(m, a, b);

export interface OwnedMandate { id: number; m: MandateRecord }
export interface Credit { asset: string; amount: string }

export interface AccountSnapshot {
  blockHeight: number;
  /** how many ids were scanned (= mandate_count at that block) */
  scanned: number;
  mandates: OwnedMandate[];
  credits: Credit[];
  /** assets whose credit read failed; their credits are unknown, not zero */
  creditErrors: string[];
  storage: string;
}

export interface Progress { done: number; total: number }

/** Runs `f` over `items`, at most `width` at a time (the RPC queue bounds it again). */
async function each<T, R>(items: T[], width: number, f: (t: T) => Promise<R>, tick: () => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
      tick();
    }
  }));
  return out;
}

export async function loadAccount(
  account: string,
  listedAssets: string[],
  onProgress: (p: Progress) => void = () => {},
  r: Reader = read,
): Promise<AccountSnapshot> {
  const first = await r<number>("mandate_count", {});
  const block = first.blockHeight;
  const count = Number(first.value);
  const storage = (await r<string>("storage_balance_of", { account_id: account }, block)).value;

  const ids = Array.from({ length: count }, (_, i) => i + 1);
  let done = 0;
  let assetsTotal = listedAssets.length;           // grows once the account's own assets are known
  const total = () => ids.length + assetsTotal;
  const tick = () => onProgress({ done: ++done, total: total() });
  onProgress({ done, total: total() });

  const records = await each(ids, 4, async (id) =>
    (await r<MandateRecord | null>("get_mandate", { mandate_id: id }, block)).value, tick);
  const mandates = records
    .map((m, i) => ({ id: ids[i], m }))
    .filter((x): x is OwnedMandate => !!x.m && x.m.owner === account);

  const own = mandates.flatMap(({ m }) => [m.terms.origin_asset, m.terms.destination_asset]);
  const assets = [...new Set([...listedAssets, ...own])];
  assetsTotal = assets.length;
  const creditErrors: string[] = [];
  const amounts = await each(assets, 4, async (asset) => {
    try { return (await r<string>("get_credit", { account_id: account, asset }, block)).value; }
    catch { creditErrors.push(asset); return "0"; }
  }, tick);
  const credits = assets
    .map((asset, i) => ({ asset, amount: amounts[i] }))
    .filter((c) => BigInt(c.amount) > 0n);

  return { blockHeight: block, scanned: count, mandates, credits, creditErrors, storage };
}

/* ------------------------------------------------------------- actions */

/**
 * A credit slot measured 145 bytes (ARCHITECTURE.md §2.11); the key holds the
 * account and asset ids, so long ids make it larger. 300 bytes is the margin
 * below which `cancel` gets a storage_deposit prepended.
 */
export const CREDIT_SLOT_MARGIN = 300n * 10n ** 19n;

/**
 * Cancel. Returning unspent escrow credits the owner, and if they hold no
 * credit in that asset yet, that writes a new slot the owner must prepay for
 * — `settle_storage` panics otherwise. So when it might, and the prepaid
 * balance is under the margin, top it up first.
 */
export function cancelTxs(o: OwnedMandate, snap: AccountSnapshot, estimate: string): Tx[] {
  const createsSlot = BigInt(o.m.escrow) > 0n
    && !snap.credits.some((c) => c.asset === o.m.terms.origin_asset);
  const txs: Tx[] = [];
  if (createsSlot && BigInt(snap.storage) < CREDIT_SLOT_MARGIN) txs.push(txStorageDeposit(estimate));
  txs.push(txCancel(o.id));
  return txs;
}

export const reapTxs = (o: OwnedMandate): Tx[] => [txReap(o.id)];
export const withdrawTxs = (c: Credit): Tx[] => [txWithdraw(c.asset)];
export const storageWithdrawTxs = (): Tx[] => [txStorageWithdraw()];
export const fundTxs = (o: OwnedMandate, amount: string): Tx[] => [txFund(o.m.terms.origin_asset, o.id, amount)];

/** Why the contract would refuse a top-up, checked before asking for a signature. */
export function fundRefusal(o: OwnedMandate, nowMs: number): string | null {
  if (!o.m.open) return "the mandate is closed";
  if (BigInt(o.m.terms.expiry_ns) <= BigInt(nowMs) * 1_000_000n) return "the mandate has expired; it can never be filled";
  return null;
}
