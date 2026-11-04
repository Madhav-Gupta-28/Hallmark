/**
 * The one way this app asks for a signature.
 *
 * Shows the batch in full (TxPreview: every field, plus the near CLI command),
 * re-checks the chain at the moment it opens, refuses to ask at all while any
 * blocker stands, and requires an explicit confirm. What is signed is exactly
 * the `txs` it was opened with — callers freeze them before opening.
 *
 * It opens without a wallet too: anyone can read the transaction and copy
 * the command. Signing needs the wallet to be connected as `signer`.
 */
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Entry, Stamp } from "@/components/doc";
import { TxPreview } from "@/components/TxPreview";
import { forgetCache, type Tx } from "@/lib/hallmark";
import { clearPending, savePending, type Pending } from "@/lib/redirect";
import { useWallet } from "@/wallet/context";

export interface Ask {
  /** short label, kept in the pending record, e.g. "withdraw" */
  kind: string;
  title: string;
  /** the account that must sign */
  signer: string;
  txs: Tx[];
  /** human summary of what this does, above the raw transactions */
  summary: ReactNode;
  /** reasons not to ask for a signature, read from the chain when the dialog opens */
  check: () => Promise<string[]>;
  /** where the wallet returns to (the Bitte redirect) */
  returnPath: string;
}

export function ConfirmTxDialog({ ask, onClose, onSigned }: {
  ask: Ask;
  onClose: () => void;
  onSigned: (hashes: string[], pending: Pending) => void;
}) {
  const w = useWallet();
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checked = useQuery({
    queryKey: ["confirm-check", ask.kind, ask.signer, JSON.stringify(ask.txs)],
    queryFn: () => { forgetCache(); return ask.check(); },
    staleTime: 0,
    gcTime: 0,
  });
  const stop = checked.data ?? [];
  const connectedAsSigner = w.accountId === ask.signer;
  const n = ask.txs.length;

  const sign = async () => {
    setSending(true);
    setError(null);
    const pending: Pending = { kind: ask.kind, signer: ask.signer, txs: ask.txs, at: Date.now() };
    savePending(pending);                            // survives the redirect
    try {
      const hashes = await w.signAndSend(ask.txs, `${location.origin}${ask.returnPath}`);
      // Only an in-page wallet gets here; a redirect wallet has navigated away.
      forgetCache();
      void qc.invalidateQueries({ queryKey: ["vault"] });
      void qc.invalidateQueries({ queryKey: ["account"] });
      onSigned(hashes, pending);
      onClose();
    } catch (e) {
      clearPending();
      setError((e as Error).message || "the wallet refused or the user cancelled");
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !sending) onClose(); }}>
      <DialogContent className="sheet block max-h-[92vh] overflow-y-auto overflow-x-hidden rounded-none border-2 border-ink p-0 shadow-[10px_10px_0_var(--ink)] sm:max-w-3xl">
        <div className="min-w-0 px-6 pb-6 pt-7 sm:px-8">
          <DialogHeader className="text-left">
            <p className="label text-faint">Execution page · NEAR mainnet · real funds</p>
            <DialogTitle className="mt-1 font-serif text-[clamp(28px,4vw,40px)] font-extrabold leading-tight">{ask.title}</DialogTitle>
            <DialogDescription className="text-[17px] text-ink">
              To be signed by <b className="typed break-all">{ask.signer}</b>. Read every line below: it is exactly what the
              wallet will be asked to sign, and nothing more.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6">{ask.summary}</div>

          <p className="label mt-8 border-b-[6px] border-double border-ink pb-1">Annex — the transactions</p>
          <div className="mt-4"><TxPreview txs={ask.txs} signer={ask.signer} /></div>

          <div className="mt-8 space-y-3">
            {checked.isPending && <p className="typed text-[14px] text-faint">re-reading the chain before asking for a signature…</p>}
            {checked.isError && <p className="typed text-[14px] text-seal">Could not re-read the chain: {checked.error.message}</p>}
            {stop.length > 0 && (
              <div className="border-l-4 border-seal pl-4">
                <Stamp>not signing this</Stamp>
                <ul className="mt-3 list-disc pl-5 text-[16px]">{stop.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
          </div>

          {!connectedAsSigner ? (
            <div className="mt-6 flex flex-wrap items-center gap-4 border-2 border-ink p-4 text-[16px]">
              <span className="flex-1">
                {w.accountId
                  ? <>The wallet is connected as <b className="typed break-all">{w.accountId}</b>; only <b className="typed break-all">{ask.signer}</b> can sign this.</>
                  : <>Connect <b className="typed break-all">{ask.signer}</b> to sign here — or copy the command above and run it yourself.</>}
              </span>
              {!w.accountId && <button className="btn btn-sm" onClick={w.openPicker}>connect</button>}
            </div>
          ) : (
            <div className="mt-6">
              <label className="flex cursor-pointer items-start gap-3 text-[17px]">
                <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-1 size-5 border-2 border-ink" />
                <span>
                  I have read {n === 1 ? "this transaction" : `all ${n} transactions`} and wish to sign{" "}
                  {n === 1 ? "it" : "them"} on NEAR mainnet.
                </span>
              </label>
              <div className="mt-6 max-w-[420px]">
                <div className={agreed ? "hand truncate text-[30px] leading-none" : "hand truncate text-[30px] leading-none opacity-20"}>{ask.signer}</div>
                <div className="sigline mt-1">Signature of the account · applied by your wallet, not by this page</div>
              </div>
              {w.redirects && (
                <p className="typed mt-4 text-[13px] text-faint">
                  This wallet signs on its own site: you will leave this page, sign there, and return here, where
                  the outcome is read from the chain.
                </p>
              )}
            </div>
          )}
          {error && <p className="typed mt-4 text-[14px] text-seal">{error} — nothing was sent.</p>}

          <div className="mt-8 flex flex-wrap justify-end gap-4">
            <button className="btn" onClick={onClose} disabled={sending}>Withdraw</button>
            <button
              className="btn btn-sign"
              onClick={() => void sign()}
              disabled={!connectedAsSigner || !agreed || sending || !checked.isSuccess || stop.length > 0}
            >
              {sending
                ? (w.redirects ? "opening your wallet…" : "waiting for your wallet…")
                : `Sign ${n === 1 ? "1 transaction" : `${n} transactions`}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Label/value lines for an `Ask`'s summary, in the order written. */
export function SummaryRows({ rows }: { rows: Record<string, ReactNode> }) {
  return (
    <div>
      {Object.entries(rows).map(([k, v]) => <Entry key={k} k={k} v={v} />)}
    </div>
  );
}
