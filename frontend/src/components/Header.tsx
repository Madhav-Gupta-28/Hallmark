import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { short } from "@/lib/hallmark";
import { cn } from "@/lib/utils";
import { useWallet } from "@/wallet/WalletProvider";

const LINKS = [
  ["/book", "The book"],
  ["/post", "Post a mandate"],
] as const;

export function Header() {
  const w = useWallet();
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <NavLink to="/book" className="font-semibold tracking-tight">hallmark</NavLink>
        <nav className="flex gap-4 text-sm">
          {LINKS.map(([to, label]) => (
            <NavLink
              key={to} to={to}
              className={({ isActive }) => cn("text-muted-foreground hover:text-foreground", isActive && "text-foreground")}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">mainnet</span>
        {!w.ready ? (
          <Button size="sm" variant="outline" disabled>restoring wallet…</Button>
        ) : w.accountId ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="font-mono" title={w.accountId}>{short(w.accountId, 10)}</span>
            <Button size="sm" variant="outline" onClick={() => void w.disconnect()}>Disconnect</Button>
          </span>
        ) : (
          <Button size="sm" onClick={w.openPicker}>Connect wallet</Button>
        )}
      </div>
      {w.error && !w.accountId && (
        <div className="mx-auto max-w-6xl px-4 pb-2 text-xs text-destructive">{w.error}</div>
      )}
    </header>
  );
}
