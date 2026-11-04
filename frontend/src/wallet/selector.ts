/* ============================================================================
   Signing — the wallet selector, built only when the reader asks to connect.

   The only module that knows the wallet library's types. Callers hand it
   transactions in the project's own `Tx` shape (lib/hallmark.ts), the same
   objects the preview and the CLI rendering are built from, so what is shown
   and what is signed cannot drift.

   Differences from the reference:
   - @near-wallet-selector 8.10.2 from npm (pinned exactly), not esm.sh.
   - No @near-wallet-selector/modal-ui: 8.10.2 ships React 18.2 as a hard
     dependency, which would put a second React in the bundle. The two-wallet
     picker is a small shadcn dialog instead (WalletProvider.tsx).
   - This file is imported lazily, so a reader who never connects never
     downloads the selector — the same property the reference has.

   A function-call access key cannot sign `storage_deposit` (needs a deposit)
   or `ft_transfer_call` (a different contract, 1 yocto), so every action here
   needs a full-access signature from the wallet itself.
   ========================================================================= */
import "./polyfills";                       // must stay first: see polyfills.ts
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMeteorWalletApp } from "@near-wallet-selector/meteor-wallet-app";
import { VAULT, type Tx } from "@/lib/hallmark";

export type WalletId = "my-near-wallet" | "meteor-wallet" | "meteor-wallet-app";

let selector: Promise<WalletSelector> | undefined;

export function getSelector(): Promise<WalletSelector> {
  selector ??= setupWalletSelector({
    network: "mainnet",
    /* Meteor ships two wallets that do NOT share a keystore: the browser
       extension and the web wallet at wallet.meteorwallet.app. An account
       created in one is invisible to the other, so offering only the extension
       tells a reader with a perfectly good Meteor account that they have no
       wallet. Both are listed; `contractId` is only the one the web wallet
       shows on its approval screen. */
    modules: [setupMyNearWallet(), setupMeteorWallet(), setupMeteorWalletApp({ contractId: VAULT })],
  });
  return selector;
}

export function activeAccount(s: WalletSelector): string | null {
  const { accounts } = s.store.getState();
  return (accounts.find((a) => a.active) ?? accounts[0])?.accountId ?? null;
}

export function subscribe(s: WalletSelector, f: (accountId: string | null) => void): () => void {
  const sub = s.store.observable.subscribe(() => f(activeAccount(s)));
  return () => sub.unsubscribe();
}

/** MyNearWallet navigates away here; Meteor resolves with the account. */
export async function signIn(id: WalletId): Promise<string | null> {
  const s = await getSelector();
  const w = await s.wallet(id);
  await w.signIn({ contractId: VAULT, methodNames: [], accounts: [] });
  return activeAccount(s);
}

export async function signOut(): Promise<void> {
  const s = await getSelector();
  if (!s.isSignedIn()) return;
  await (await s.wallet()).signOut();
}

/** Which wallet is connected, so the UI can say whether signing will redirect. */
export async function selectedWalletId(): Promise<WalletId | null> {
  const s = await getSelector();
  return (s.store.getState().selectedWalletId as WalletId | null) ?? null;
}

/**
 * Sign and send a batch, exactly as given.
 *
 * MyNearWallet redirects to sign and returns to `callbackUrl` with
 * `?transactionHashes=` or `?errorCode=` — this promise never resolves for it,
 * and the page reads the result from the URL on return (lib/redirect.ts).
 * Meteor resolves here with one outcome per transaction; only their hashes are
 * returned, and the page reads the final result off the chain either way.
 */
export async function signAndSend(txs: Tx[], callbackUrl: string): Promise<string[]> {
  const s = await getSelector();
  if (!s.isSignedIn()) throw new Error("connect a wallet first");
  const w = await s.wallet();
  const outcomes = await w.signAndSendTransactions({
    callbackUrl,
    transactions: txs.map((t) => ({
      receiverId: t.receiverId,
      actions: t.actions.map((a) => ({
        type: "FunctionCall" as const,
        params: { methodName: a.methodName, args: a.args, gas: a.gas, deposit: a.deposit },
      })),
    })),
  });
  return (outcomes ?? []).map((o) => o.transaction.hash);
}
