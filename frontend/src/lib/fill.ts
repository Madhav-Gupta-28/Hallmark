/**
 * Filling a mandate — the counterpart of `post.ts`.
 *
 * A fill is one `ft_transfer_call` of the DESTINATION asset to the vault: the
 * transfer itself is the delivery (§2, the filler delivers first), and the
 * signed quote rides along in `msg`. The contract verifies the venue's
 * signature over those exact bytes, prices what actually arrived, and either
 * credits both legs or refuses and the token returns the delivery in full.
 *
 * Two things the static site's fill never did, and both are real:
 *
 *   The filler pays for the two credit slots the fill writes (§6), so a filler
 *   with no prepaid storage needs a `storage_deposit` in the same batch, the
 *   way `openTxs` does for the owner.
 *
 *   It delivered `minAmountOut` — the signed floor — which is the cheapest
 *   legal delivery and therefore what a profit-maximising filler sends. It is
 *   also the one the contract refuses whenever the floor alone breaches the
 *   ceiling, even though the full quote would pass. The page offers the full
 *   quote first for that reason, and the floor only when the chain has just
 *   said it would be honoured.
 */
import {
  type MandateTerms, type Tx, txFill, txStorageDeposit,
} from "@/lib/hallmark";

/** `storage_deposit` only when the filler's prepaid balance is short, then the fill. */
export function fillTxs(
  terms: MandateTerms, mandateId: number, canonical: string, signature: string,
  delivered: string, prepaid: string, estimate: string,
): Tx[] {
  const txs: Tx[] = [];
  if (BigInt(prepaid) < BigInt(estimate)) txs.push(txStorageDeposit(estimate));
  txs.push(txFill(terms.destination_asset, mandateId, canonical, signature, delivered));
  return txs;
}

/** Why this account cannot fill right now, read from the chain. Empty means it can. */
export function fillBlockers(
  p: { tokenBalance: string; vaultRegistered: boolean; nearAvailable: string; prepaid: string; estimate: string },
  delivered: string, outSymbol: string, gasHeadroom: bigint,
): string[] {
  const out: string[] = [];
  if (!p.vaultRegistered) out.push(`The vault is not registered on ${outSymbol}, so a transfer to it would fail.`);
  if (BigInt(p.tokenBalance) < BigInt(delivered)) out.push(`You hold less ${outSymbol} than this delivery needs.`);
  const needed = (BigInt(p.prepaid) < BigInt(p.estimate) ? BigInt(p.estimate) : 0n) + gasHeadroom;
  if (BigInt(p.nearAvailable) < needed) out.push("Not enough spendable NEAR for the storage deposit and gas.");
  return out;
}
