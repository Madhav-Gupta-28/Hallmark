/**
 * Whatever came back from a wallet — MyNearWallet's redirect or Meteor's
 * hashes — and what each transaction actually did, read from the chain.
 *
 * MyNearWallet returns with a full page load and the result in the URL, so
 * `useSigned` reads it once, purely, at mount; Meteor resolves in place and
 * the page hands its hashes to `setSigned`. The wallet's parameters are then
 * removed from the URL so a reload does not replay them, and the pending
 * record is cleared only once it is held in state (StrictMode runs effects
 * twice; a read-and-clear in one step would lose the signer).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPLORER, forgetCache, near, short } from "@/lib/hallmark";
import {
  clearPending, interpret, loadPending, readCallback, txOutcome, withoutCallback,
  type Callback, type Interpreted, type Pending,
} from "@/lib/redirect";
import { useWallet } from "@/wallet/WalletProvider";

export interface Signed { cb: Callback; pending: Pending | null }

export function useSigned() {
  return useState<Signed | null>(() => {
    const cb = readCallback(location.search);
    return cb ? { cb, pending: loadPending() } : null;
  });
}

export function SigningResult({ signed }: { signed: Signed }) {
  const navigate = useNavigate();
  const w = useWallet();
  const qc = useQueryClient();

  useEffect(() => {
    clearPending();
    if (readCallback(location.search)) navigate(withoutCallback(location.href), { replace: true });
  }, [signed, navigate]);

  const signer = signed.pending?.signer ?? w.accountId;
  const hashes = signed.cb.kind === "signed" ? signed.cb.hashes : [];
  const outcomes = useQueries({
    queries: hashes.map((h) => ({
      queryKey: ["tx", h, signer],
      queryFn: async () => interpret(await txOutcome(h, signer!)),
      enabled: !!signer,
      staleTime: Infinity,
      retry: false,
    })),
  });

  // Something changed on chain: drop every cached read of the vault and the account.
  const anyOk = outcomes.some((o) => o.data?.ok);
  useEffect(() => {
    if (!anyOk) return;
    forgetCache();
    void qc.invalidateQueries({ queryKey: ["vault"] });
    void qc.invalidateQueries({ queryKey: ["account"] });
  }, [anyOk, qc]);

  if (signed.cb.kind === "error") {
    return (
      <Alert variant="destructive" className="mb-8">
        <AlertTitle>The wallet did not sign</AlertTitle>
        <AlertDescription>
          {signed.cb.message || signed.cb.code} ({signed.cb.code}). Nothing was sent.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>What happened on chain</CardTitle>
        <CardDescription>
          Read from each transaction's final outcome{signer ? <> as sent by <b>{signer}</b></> : null} — not assumed
          from the wallet's say-so. A transfer can succeed while the vault refuses it; the token then refunds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!signer && <p className="text-muted-foreground">Connect the signing account to read the outcomes.</p>}
        {hashes.map((h, i) => {
          const o = outcomes[i];
          return (
            <div key={h} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border p-3">
              <a className="font-mono text-xs underline" href={`${EXPLORER}/txns/${h}`} target="_blank" rel="noreferrer">{short(h, 10)}</a>
              {o.isPending && signer && <span className="text-muted-foreground">waiting for finality…</span>}
              {o.isError && <span className="text-destructive">could not read it: {o.error.message}</span>}
              {o.data && <OutcomeLine r={o.data} />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const Ok = ({ children }: { children: string }) => <Badge className="bg-emerald-600">{children}</Badge>;
const No = ({ children }: { children: string }) => <Badge variant="destructive">{children}</Badge>;

function OutcomeLine({ r }: { r: Interpreted }) {
  switch (r.kind) {
    case "storage_deposit":
      return <><Ok>storage prepaid</Ok><span className="text-muted-foreground">balance now {near(r.credited, 5)} NEAR</span></>;
    case "open":
      return r.ok
        ? <><Ok>mandate opened</Ok><Link className="underline" to={`/mandate/${r.mandateId}`}>Mandate #{r.mandateId} →</Link></>
        : <><No>not opened</No><span>{r.reason}. The token refunded the transfer.</span></>;
    case "fund":
      return r.ok
        ? <><Ok>escrow topped up</Ok><Link className="underline" to={`/mandate/${r.mandateId}`}>Mandate #{r.mandateId} →</Link></>
        : <><No>not topped up</No><span>{r.reason}. The token refunded the transfer.</span></>;
    case "withdraw":
    case "storage_withdraw":
      return r.ok
        ? <Ok>{r.kind === "withdraw" ? "withdrawn" : "storage withdrawn"}</Ok>
        : <><No>not paid out</No><span>{r.reason}</span></>;
    case "cancel":
      return <><Ok>mandate cancelled</Ok><span className="text-muted-foreground">#{r.mandateId}; unspent escrow is now a credit</span></>;
    case "reap":
      return <><Ok>record reaped</Ok><span className="text-muted-foreground">{near(r.refunded, 5)} NEAR of storage returned to your prepaid balance</span></>;
    default:
      return r.ok ? <Badge variant="secondary">succeeded</Badge> : <><No>failed</No><span>{r.reason}</span></>;
  }
}
