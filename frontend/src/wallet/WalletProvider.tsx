/**
 * The signed-in account, app-wide.
 *
 * The selector (./selector.ts) is loaded lazily, and only when there is a
 * reason to: the user clicks Connect, a session already exists in
 * localStorage, or the URL carries a wallet callback (MyNearWallet's sign-in
 * returns with `account_id`, its signing with `transactionHashes`). Reading
 * the book or a mandate never downloads it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { Tx } from "@/lib/hallmark";
import type * as Selector from "./selector";
import type { WalletId } from "./selector";

const load = () => import("./selector");

const SESSION_KEYS = ["near-wallet-selector:selectedWalletId", "near-wallet-selector:selectedWalletId:pending"];
const CALLBACK_PARAMS = ["account_id", "all_keys", "transactionHashes", "errorCode"];

function hasReasonToLoad(): boolean {
  try {
    if (SESSION_KEYS.some((k) => { const v = localStorage.getItem(k); return v && v !== "null"; })) return true;
  } catch { /* storage blocked */ }
  const q = new URLSearchParams(location.search);
  return CALLBACK_PARAMS.some((p) => q.has(p));
}

interface WalletState {
  /** the selector has finished restoring any session (or was never needed) */
  ready: boolean;
  accountId: string | null;
  walletId: WalletId | null;
  /** MyNearWallet signs by leaving the page */
  redirects: boolean;
  error: string | null;
  openPicker: () => void;
  disconnect: () => Promise<void>;
  /** sign and send; for MyNearWallet this navigates away and never resolves */
  signAndSend: (txs: Tx[], callbackUrl: string) => Promise<string[]>;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [mod, setMod] = useState<typeof Selector | null>(null);
  const [ready, setReady] = useState(() => !hasReasonToLoad());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<WalletId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<WalletId | null>(null);

  // Once per provider: StrictMode re-runs effects, and Connect can race a
  // session restore, and either would otherwise subscribe to the store twice.
  const attaching = useRef<Promise<typeof Selector> | null>(null);
  const attach = useCallback(() => {
    attaching.current ??= (async () => {
      const m = await load();
      const s = await m.getSelector();
      setMod(m);
      setAccountId(m.activeAccount(s));
      setWalletId(await m.selectedWalletId());
      m.subscribe(s, (id) => {
        setAccountId(id);
        void m.selectedWalletId().then(setWalletId);
      });
      return m;
    })();
    attaching.current.catch(() => { attaching.current = null; });   // allow a retry
    return attaching.current;
  }, []);

  // Restoring a session is syncing with an external system (the selector's
  // storage), and every setState here happens after an await.
  useEffect(() => {
    if (!hasReasonToLoad()) return;
    attach()
      .catch((e: Error) => setError(`could not restore the wallet session — ${e.message}`))
      .finally(() => setReady(true));
  }, [attach]);

  const connect = useCallback(async (id: WalletId) => {
    setBusy(id);
    setError(null);
    try {
      const m = mod ?? (await attach());
      await m.signIn(id);                      // MyNearWallet leaves the page here
      setPicking(false);
    } catch (e) {
      setError((e as Error).message || "the wallet refused or the user cancelled");
    } finally {
      setBusy(null);
    }
  }, [mod, attach]);

  const value = useMemo<WalletState>(() => ({
    ready, accountId, walletId, error,
    redirects: walletId === "my-near-wallet",
    openPicker: () => { setError(null); setPicking(true); },
    disconnect: async () => {
      if (mod) await mod.signOut();
      setAccountId(null);
      setWalletId(null);
    },
    signAndSend: async (txs, callbackUrl) => {
      const m = mod ?? (await attach());
      return m.signAndSend(txs, callbackUrl);
    },
  }), [ready, accountId, walletId, error, mod, attach]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a NEAR wallet</DialogTitle>
            <DialogDescription>
              Mainnet. Connecting signs nothing and moves nothing; every transaction is shown in full and needs
              your explicit confirmation first. Reading never needs a wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {/* static list, so the picker renders without loading the selector */}
            {([
              ["my-near-wallet", "MyNearWallet", "web wallet — signs on mynearwallet.com and redirects back here"],
              ["meteor-wallet", "Meteor", "browser extension or popup — signs without leaving this page"],
            ] as const).map(([id, name, how]) => (
              <Button
                key={id} variant="outline" className="h-auto justify-start py-3 text-left"
                disabled={busy !== null} onClick={() => void connect(id)}
              >
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{busy === id ? `Opening ${name}…` : name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{how}</span>
                </span>
              </Button>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
