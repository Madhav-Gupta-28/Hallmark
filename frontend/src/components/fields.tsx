import type { ReactNode } from "react";
import { EXPLORER, short, units } from "@/lib/hallmark";
import type { TokenMeta } from "@/lib/tokens";

/** A label/value line inside a `<dl>`. */
export function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 text-right">{v}</dd>
    </div>
  );
}

export function Mono({ children, n = 18 }: { children: string; n?: number }) {
  return <span className="block truncate font-mono text-xs" title={children}>{short(children, n)}</span>;
}

export function Account({ id }: { id: string }) {
  return (
    <a className="font-mono text-xs underline" href={`${EXPLORER}/address/${id}`} target="_blank" rel="noreferrer" title={id}>
      {short(id, 10)}
    </a>
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
