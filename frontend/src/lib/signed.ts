/**
 * What came back from a wallet, read once at mount.
 *
 * Kept out of SigningResult.tsx for the same reason the wallet context is kept
 * out of WalletProvider.tsx: a module that exports both a hook and a component
 * cannot Fast Refresh, so every edit to the component invalidated the hook and
 * took the page's state with it.
 */
import { useState } from "react";
import { loadPending, readCallback, type Callback, type Pending } from "@/lib/redirect";

export interface Signed { cb: Callback; pending: Pending | null }

export function useSigned() {
  return useState<Signed | null>(() => {
    const cb = readCallback(location.search);
    return cb ? { cb, pending: loadPending() } : null;
  });
}
