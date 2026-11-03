/**
 * The masthead: the document's title, which agreement register this is, and
 * the table of contents as plain links. The wallet is a link too — connecting
 * is an act of identification, not a feature.
 */
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { short, VAULT } from "@/lib/hallmark";
import { openCountQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useWallet } from "@/wallet/WalletProvider";

export function Header() {
  const w = useWallet();
  const open = useQuery(openCountQuery);
  const [menu, setMenu] = useState(false);
  const links: Array<[string, string]> = [
    ["/book", "register"],
    ["/post", "draw up"],
    ["/verify", "verify"],
    [w.accountId ? `/account/${w.accountId}` : "/account", "statement"],
    ["/how", "how"],
    ["/limits", "limits"],
  ];

  return (
    <header className="doc pt-6">
      <div className="double-rule flex flex-wrap items-end gap-x-6 gap-y-3 pb-3">
        <NavLink to="/" className="font-serif text-[34px] font-extrabold leading-none tracking-[0.01em]">
          HALLMARK.
        </NavLink>
        <span className="typed hidden text-[13px] text-faint md:inline">
          Agreement register · {VAULT} · NEAR mainnet ·{" "}
          <span className="live-dot mx-1" aria-hidden /> {open.isSuccess ? `${open.data} in force` : "…"}
        </span>
        <span className="flex-1" />
        <button
          className="typed text-[14px] underline md:hidden"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          {menu ? "close" : "contents"}
        </button>
        <nav
          aria-label="Contents"
          className={cn("w-full flex-wrap gap-x-5 gap-y-1 md:flex md:w-auto", menu ? "flex" : "hidden")}
        >
          {links.map(([to, label]) => (
            <NavLink
              key={label} to={to} onClick={() => setMenu(false)}
              className={({ isActive }) => cn("lnk typed text-[15px]", isActive && "hl text-ink no-underline")}
            >
              {label}
            </NavLink>
          ))}
          {!w.ready ? (
            <span className="typed text-[15px] text-faint">restoring…</span>
          ) : w.accountId ? (
            <span className="typed text-[15px]">
              <span className="hand text-[20px]" title={w.accountId}>{short(w.accountId, 8)}</span>{" "}
              <button className="lnk" onClick={() => void w.disconnect()}>sign out</button>
            </span>
          ) : (
            <button className="lnk typed text-[15px]" onClick={w.openPicker}>connect</button>
          )}
        </nav>
      </div>
      {w.error && !w.accountId && <p className="typed mt-2 text-[13px] text-seal">{w.error}</p>}
    </header>
  );
}
