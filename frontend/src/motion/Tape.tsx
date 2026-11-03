/**
 * The register tape: a band of the vault's live state, scrolling past under
 * the masthead like a ticker. Every number on it is a view call (the same
 * cached queries the pages use); the rest are the agreement's own terms.
 * It pauses under the pointer, and stands still under reduced motion.
 */
import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { near, short, SIGNER, VAULT, view, viewAccount } from "@/lib/hallmark";
import { bookQuery, openCountQuery } from "@/lib/queries";

export function Tape() {
  const open = useQuery(openCountQuery);
  const total = useQuery({ queryKey: ["vault", "mandate_count"], queryFn: () => view<number>("mandate_count") });
  const acct = useQuery({ queryKey: ["vault", "account"], queryFn: () => viewAccount() });
  const book = useQuery(bookQuery);

  const worst = book.data?.filter(([, m]) => m.fills > 0)
    .reduce<{ bps: number; ceil: number; id: number } | null>((w, [id, m]) =>
      (!w || m.worst_bps > w.bps ? { bps: m.worst_bps, ceil: m.terms.max_cost_bps, id } : w), null);

  const items: Array<[string, "live" | "blue" | "red" | "plain"]> = [
    ["LIVE · NEAR MAINNET", "live"],
    [VAULT, "plain"],
    [open.isSuccess ? `${open.data} ${open.data === 1 ? "agreement" : "agreements"} in force` : "reading the register…", "blue"],
    [total.isSuccess ? `${total.data} ever drawn up` : "…", "plain"],
    [acct.isSuccess ? `vault holds ${near(acct.data.amount, 3)} NEAR` : "…", "plain"],
    [worst ? `worst fill on the register: ${worst.bps} bps against a ${worst.ceil} bps ceiling (§${worst.id}) — honoured` : "no fill on the register yet", "blue"],
    ["Exhibit A · validly signed · 10000 bps · REFUSED", "red"],
    ["no oracle · no price feed · no custodian", "plain"],
    [`trusted signer ${short(SIGNER, 12)}`, "plain"],
    ["every figure is a keyless view call", "plain"],
  ];

  const run = (dup: boolean) => (
    <span className="inline-flex shrink-0 items-center" aria-hidden={dup}>
      {items.map(([t, k], i) => (
        <Fragment key={i}>
          <span className={k === "blue" ? "text-[#9fb4ff]" : k === "red" ? "text-[#ff8a8d]" : undefined}>
            {k === "live" && <span className="live-dot mr-2 bg-[#9fb4ff]" />}{t}
          </span>
          <span className="mx-5 opacity-50">§</span>
        </Fragment>
      ))}
    </span>
  );

  return (
    <div className="tape typed py-2 text-[13px] font-bold uppercase tracking-wide" role="marquee" aria-label="Live state of the vault">
      <div className="tape-track">{run(false)}{run(true)}</div>
    </div>
  );
}
