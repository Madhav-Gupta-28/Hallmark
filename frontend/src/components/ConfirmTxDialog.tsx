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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { TxPreview } from "@/components/TxPreview";
import { forgetCache, type Tx } from "@/lib/hallmark";
import { clearPending, savePending, type Pending } from "@/lib/redirect";
import { useWallet } from "@/wallet/WalletProvider";

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
  /** where the wallet returns to (MyNearWallet redirect) */
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
    savePending(pending);                            // survives MyNearWallet's redirect
    try {
      const hashes = await w.signAndSend(ask.txs, `${location.origin}${ask.returnPath}`);
      // Only Meteor gets here; MyNearWallet has navigated away.
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ask.title} — NEAR mainnet</DialogTitle>
          <DialogDescription>
            Signed by <b>{ask.signer}</b>. Read every field below; this is exactly what the wallet will be asked to
            sign, nothing more.
          </DialogDescription>
        </DialogHeader>

        {ask.summary}

        <TxPreview txs={ask.txs} signer={ask.signer} />

        {checked.isPending && <p className="text-sm text-muted-foreground">Re-checking the chain…</p>}
        {checked.isError && <p className="text-sm text-destructive">Could not re-check the chain: {checked.error.message}</p>}
        {stop.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Not signing this</AlertTitle>
            <AlertDescription><ul className="list-disc pl-4">{stop.map((s) => <li key={s}>{s}</li>)}</ul></AlertDescription>
          </Alert>
        )}

        {!connectedAsSigner ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
            <span className="flex-1">
              {w.accountId
                ? <>The wallet is connected as <b>{w.accountId}</b>; only <b>{ask.signer}</b> can sign this.</>
                : <>Connect <b>{ask.signer}</b> to sign here — or copy the command above and run it yourself.</>}
            </span>
            {!w.accountId && <Button size="sm" variant="outline" onClick={w.openPicker}>Connect wallet</Button>}
          </div>
        ) : (
          <>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
              <span>
                I have read {n === 1 ? "this transaction" : `all ${n} transactions`} and want to sign{" "}
                {n === 1 ? "it" : "them"} on NEAR mainnet.
              </span>
            </label>
            {w.redirects && (
              <p className="text-xs text-muted-foreground">
                MyNearWallet signs on its own site: you will leave this page, sign there, and come back here, where
                the result is read from the chain.
              </p>
            )}
          </>
        )}
        {error && <p className="text-sm text-destructive">{error} — nothing was sent.</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button
            onClick={() => void sign()}
            disabled={!connectedAsSigner || !agreed || sending || !checked.isSuccess || stop.length > 0}
          >
            {sending
              ? (w.redirects ? "Opening MyNearWallet…" : "Waiting for your wallet…")
              : `Sign ${n === 1 ? "1 transaction" : `${n} transactions`}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Label/value rows for an `Ask`'s summary, in the order written. */
export function SummaryRows({ rows }: { rows: Record<string, ReactNode> }) {
  return (
    <dl className="divide-y rounded-md border px-3 text-sm">
      {Object.entries(rows).map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
