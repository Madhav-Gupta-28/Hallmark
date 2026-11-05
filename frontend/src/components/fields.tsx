import { units } from "@/lib/hallmark";
import type { TokenMeta } from "@/lib/tokens";

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
