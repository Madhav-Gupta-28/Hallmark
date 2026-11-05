import { units } from "@/lib/hallmark";
import { meta, type TokenMeta, type TokenTable } from "@/lib/tokens";

/**
 * A token symbol, and whether the venue has ever heard of it.
 *
 * The register is permissionless: anyone can call `ft_on_transfer` from a token
 * contract they wrote themselves and open a mandate paying in it. The contract
 * is not wrong to allow that — escrow is always backed by a real transfer from
 * whatever token the terms name, and choosing what is worth filling is the
 * filler's job, not the vault's. But a filler delivers real USDT *first*, so
 * the one thing the page must never do is let an asset nobody lists look like
 * an asset everybody does.
 *
 * `meta` already answers it: `dp === null` means 1Click's list does not carry
 * this asset, so the symbol here is a guess made from the account name. When
 * the list itself is unavailable the floor pair still resolves, and everything
 * else is honestly marked unknown — which is the same warning for a different
 * reason, and still the right one.
 */
export function Sym({ table, asset }: { table: TokenTable; asset: string }) {
  const t = meta(table, asset);
  if (t.dp !== null) return <>{t.symbol}</>;
  return (
    <span
      className="text-seal"
      title={`${asset} is not in 1Click's token list. This symbol is guessed from the account name and the asset is unverified — read the amount as base units.`}
    >
      {t.symbol}<sup aria-label=" (unlisted asset)">?</sup>
    </span>
  );
}

/** Exact base-unit formatting. If the decimals are unknown, says so rather than guessing. */
export function Amount({ v, tok }: { v: string; tok: TokenMeta }) {
  if (tok.dp === null) {
    return <span title="decimals unknown">{v} <span className="text-muted-foreground">base units</span></span>;
  }
  return (
    <span title={`${v} base units`}>
      {units(v, tok.dp, 6)} <span className="text-muted-foreground">{tok.symbol}</span>
    </span>
  );
}
