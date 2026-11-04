/**
 * The signed-in account, app-wide.
 *
 * The selector (./selector.ts) is loaded lazily, and only when there is a
 * reason to: the user clicks Connect, a session already exists in
 * localStorage, or the URL carries a wallet callback (a redirect wallet's sign-in
 * returns with `account_id`, its signing with `transactionHashes`). Reading
 * the book or a mandate never downloads it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { WalletCtx, type WalletState } from "@/wallet/context";
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
      await m.signIn(id);                      // a redirect wallet leaves the page here
      setPicking(false);
    } catch (e) {
      setError((e as Error).message || "the wallet refused or the user cancelled");
    } finally {
      setBusy(null);
    }
  }, [mod, attach]);

  const value = useMemo<WalletState>(() => ({
    ready, accountId, walletId, error,
    // Neither wallet left in the list navigates away to sign: Meteor signs in
    // place, HERE on the phone. The redirect machinery below stays because it
    // is what survives one, and NEAR has retired two web wallets this month.
    redirects: false,
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
    <WalletCtx.Provider value={value}>
      {children}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sheet rounded-none border-2 border-ink p-7 shadow-[10px_10px_0_var(--ink)] sm:max-w-lg">
          <DialogHeader className="text-left">
            <p className="label text-faint">Identification of a party · NEAR mainnet</p>
            <DialogTitle className="font-serif text-[32px] font-extrabold leading-tight">Who is signing?</DialogTitle>
            <DialogDescription className="text-[17px] text-ink">
              Connecting signs nothing and moves nothing. Every transaction is shown in full, and needs your explicit
              confirmation, before a wallet is asked for anything. Reading never needs a wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 grid gap-4">
            {/* static list, so the picker renders without loading the selector */}
            {([
              ["meteor-wallet", "Meteor", "the browser extension — signs without leaving this page. Making an account sends you to Meteor's website first, and that account is not in the extension until you import it"],
              ["here-wallet", "HERE", "your phone, or HERE's own web wallet — approve the transaction there"],
            ] as const).map(([id, name, how]) => (
              <button
                key={id} className="btn h-auto justify-start whitespace-normal py-3 text-left normal-case"
                disabled={busy !== null} onClick={() => void connect(id)}
              >
                <span className="flex flex-col items-start gap-1">
                  <span className="text-[16px] uppercase">{busy === id ? `opening ${name}…` : name}</span>
                  <span className="font-serif text-[15px] font-medium tracking-normal">{how}</span>
                </span>
              </button>
            ))}
          </div>
          {error && <p className="typed text-[14px] text-seal">{error}</p>}
        </DialogContent>
      </Dialog>
    </WalletCtx.Provider>
  );
}
