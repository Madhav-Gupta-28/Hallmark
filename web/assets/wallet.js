/* ============================================================================
   Hallmark — signing.

   This is the only file in the project that loads third-party code, and it is
   imported by exactly one page: app.html. Every other page — the overview, the
   mechanism, the limits — stays literally dependency-free, because their whole
   value is that nothing sits between the reader and the chain.

   Signing is a different problem from verifying, and it is worth being precise
   about why this file has to exist.

   A NEAR *function-call access key* can only sign calls that (a) target the one
   contract it was granted for and (b) attach a ZERO deposit. Posting a mandate
   needs `storage_deposit` on the vault WITH a deposit attached, and then
   `ft_transfer_call` on the TOKEN — a different contract — with one yoctoNEAR.
   Both conditions are violated, by design, in opposite directions. So there is
   no key this page could hold that would let it transact on a user's behalf:
   a real owner flow needs a full-access signature, which means a wallet, which
   means a wallet library.

   What this file refuses to do is pretend that is a small thing. Every action
   on the app page also renders the exact transaction and the exact `near` CLI
   command that performs it, so a user who would rather not connect a wallet to
   a hackathon project — the correct instinct — can read the bytes and run it
   themselves. The wallet is a convenience over that, never a substitute for it.
   ========================================================================= */

import { VAULT } from "./hallmark.js?v=067aeb46";

/* Pinned exact versions. `@near-wallet-selector` is NEAR's own library; the
   two wallets are the ones that need no prior setup (MyNearWallet, web) and
   the common extension (Meteor). Nothing is loaded until `connect()` is
   actually called, so a reader who never clicks Connect never fetches a byte
   of this. */
const V = "8.10.2";
const ESM = (p) => `https://esm.sh/@near-wallet-selector/${p}@${V}`;

let _sel = null;          // the selector, built once
let _loading = null;      // in-flight build, so two clicks do not build twice
const listeners = new Set();

/** Tell every subscriber the signed-in account changed (or went away). */
function announce() {
  const id = accountId();
  for (const f of listeners) { try { f(id); } catch {} }
}

export function onAccount(f) { listeners.add(f); f(accountId()); return () => listeners.delete(f); }

/** The signed-in account id, or null. Cheap, synchronous, safe before connect. */
export function accountId() {
  if (!_sel) return null;
  const a = _sel.store.getState().accounts.find((x) => x.active) ?? _sel.store.getState().accounts[0];
  return a?.accountId ?? null;
}

/** Build the selector. Idempotent. Throws a readable error if the CDN is down. */
export async function ready() {
  if (_sel) return _sel;
  if (_loading) return _loading;
  _loading = (async () => {
    let core, mnw, meteor, modal;
    try {
      [core, mnw, meteor, modal] = await Promise.all([
        import(ESM("core")), import(ESM("my-near-wallet")),
        import(ESM("meteor-wallet")), import(ESM("modal-ui")),
      ]);
    } catch (e) {
      throw new Error(
        "could not load the NEAR wallet selector from esm.sh. Every action on " +
        "this page also shows the exact `near` CLI command — use that instead."
      );
    }
    // The modal ships its own stylesheet; it is only needed once connect runs.
    if (!document.getElementById("wsel-css")) {
      const l = document.createElement("link");
      l.id = "wsel-css"; l.rel = "stylesheet";
      l.href = `${ESM("modal-ui")}/styles.css`;
      document.head.append(l);
    }
    _sel = await core.setupWalletSelector({
      network: "mainnet",
      modules: [mnw.setupMyNearWallet(), meteor.setupMeteorWallet()],
    });
    _sel.store.observable.subscribe(announce);
    _sel.__modal = modal.setupModal(_sel, { contractId: VAULT });
    return _sel;
  })();
  try { return await _loading; } finally { _loading = null; }
}

/** Open the wallet picker. Resolves once the user has picked, or cancelled. */
export async function connect() {
  const sel = await ready();
  if (sel.isSignedIn()) return accountId();
  return new Promise((done) => {
    const un = sel.__modal.on("onHide", () => { un.remove(); done(accountId()); });
    sel.__modal.show();
  });
}

export async function disconnect() {
  if (!_sel || !_sel.isSignedIn()) return;
  const w = await _sel.wallet();
  await w.signOut();
  announce();
}

/**
 * Sign and send a batch.
 *
 * `txs` is a list of { receiverId, actions:[{ methodName, args, gas, deposit }] }
 * in the project's own shape — deliberately not the selector's, so callers never
 * import the library's types and this file stays the only thing that knows them.
 *
 * MyNearWallet is redirect-based: it navigates away to sign and comes back, so
 * for that wallet this promise may simply never resolve. Callers must treat a
 * pending state as normal and re-read chain state on return, never assume a
 * resolved promise is the only success path.
 */
export async function signAndSend(txs) {
  const sel = await ready();
  if (!sel.isSignedIn()) throw new Error("connect a wallet first");
  const w = await sel.wallet();
  const transactions = txs.map((t) => ({
    receiverId: t.receiverId,
    actions: t.actions.map((a) => ({
      type: "FunctionCall",
      params: {
        methodName: a.methodName,
        args: a.args ?? {},
        gas: String(a.gas ?? 30_000_000_000_000n),
        deposit: String(a.deposit ?? "0"),
      },
    })),
  }));
  return w.signAndSendTransactions({ transactions });
}
