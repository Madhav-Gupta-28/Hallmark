/**
 * The wallet context and its hook, kept apart from the provider component.
 *
 * Vite's Fast Refresh can only swap a module whose exports are all components.
 * While `useWallet` lived beside `WalletProvider`, every edit to that file
 * invalidated it, React remounted the consumers against a *new* context object
 * while the provider still held the old one, and every page crashed with
 * "useWallet outside WalletProvider" until a full reload. The fix is this file:
 * the context identity now survives an edit to the provider.
 */
import { createContext, useContext } from "react";
import type { Tx } from "@/lib/hallmark";
import type { WalletId } from "@/wallet/selector";

export interface WalletState {
  ready: boolean;
  accountId: string | null;
  walletId: WalletId | null;
  error: string | null;
  /** true when the connected wallet signs by leaving the page */
  redirects: boolean;
  openPicker: () => void;
  disconnect: () => Promise<void>;
  /** sign and send; for a redirect wallet this navigates away and never resolves */
  signAndSend: (txs: Tx[], callbackUrl: string) => Promise<string[]>;
}

export const WalletCtx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(WalletCtx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
