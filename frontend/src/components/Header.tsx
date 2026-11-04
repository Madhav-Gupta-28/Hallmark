/**
 * The masthead: the title, the one account every figure on the site is read
 * from, and four places to go. Everything else that used to live up here —
 * which register this is, which network, how many agreements are in force —
 * is either obvious or is on the page you are about to open, so it is gone.
 * The wallet is a link too: connecting is an act of identification, not a
 * feature.
 */
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { EXPLORER, short, VAULT } from "@/lib/hallmark";
import { cn } from "@/lib/utils";
import { useWallet } from "@/wallet/context";

export function Header() {
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  const links: Array<[string, string]> = [
    ["/book", "register"],
    ["/post", "draw up"],
    ["/fill", "fill"],
    ["/how", "how it works"],
    ["/limits", "limits"],
  ];

  return (
    <header className="doc pt-6">
      <div className="double-rule pb-3.5">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <NavLink to="/" className="font-serif text-[34px] font-extrabold leading-none tracking-[0.01em]">
            HALLMARK.
          </NavLink>
          <a
            className="lnk typed text-[13px]"
            href={`${EXPLORER}/address/${VAULT}`}
            target="_blank"
            rel="noreferrer"
          >
            {VAULT} ↗
          </a>
          <span className="flex-1" />
          <button
            className="typed text-[14px] underline md:hidden"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            {menu ? "close" : "contents"}
          </button>
        </div>
        <nav
          aria-label="Contents"
          className={cn("mt-3 w-full flex-wrap gap-x-5 gap-y-1 md:flex", menu ? "flex" : "hidden md:flex")}
        >
          {links.map(([to, label]) => (
            <NavLink
              key={label} to={to} onClick={() => setMenu(false)}
              className={({ isActive }) => cn("lnk typed text-[15px]", isActive && "hl text-ink no-underline")}
            >
              {label}
            </NavLink>
          ))}
          <span className="hidden flex-1 md:block" />
          {!w.ready ? (
            <span className="typed text-[15px] text-faint">restoring…</span>
          ) : w.accountId ? (
            <span className="typed text-[15px]">
              <NavLink to={`/account/${w.accountId}`} className="lnk" onClick={() => setMenu(false)}>
                {short(w.accountId, 8)}
              </NavLink>{" "}
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
