import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TxPreview } from "@/components/TxPreview";
import { EXPLORER, forgetCache, near, short, units, view, type MandateTerms, type Tx } from "@/lib/hallmark";
import {
  blockers, DEFAULTS, FALLBACK_ESTIMATE, openTxs, preflight, readForm, type FormInput,
} from "@/lib/post";
import { tokensQuery } from "@/lib/queries";
import {
  clearPending, interpret, loadPending, readCallback, savePending, txOutcome, withoutCallback,
  type Callback, type Pending,
} from "@/lib/redirect";
import { meta, type TokenTable } from "@/lib/tokens";
import { useWallet } from "@/wallet/WalletProvider";

/** What the confirm dialog shows, frozen at the moment it opened: exactly this is signed. */
interface Snapshot { txs: Tx[]; terms: MandateTerms; amount: string; signer: string }

export function PostPage() {
  const w = useWallet();
  const tokens = useQuery(tokensQuery);
  const table = useMemo(() => tokens.data ?? {}, [tokens.data]);

  // MyNearWallet comes back with a full page load and the result in the URL:
  // read it once, purely, at mount. Meteor resolves in place and hands its
  // hashes over through `onSigned`. Same display and same chain read for both.
  const [signed, setSigned] = useState<Signed | null>(() => {
    const cb = readCallback(location.search);
    return cb ? { cb, pending: loadPending() } : null;
  });

  const [form, setForm] = useState<FormInput>({ ...DEFAULTS });
  // expiry is "now + N days"; stamp it when the form changes, not on every render
  const [stamp, setStamp] = useState(() => Date.now());
  const set = (k: keyof FormInput) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setStamp(Date.now()); };

  const parsed = useMemo(() => {
    try { return { ok: true as const, ...readForm(form, table, stamp) }; }
    catch (e) { return { ok: false as const, error: (e as Error).message }; }
  }, [form, table, stamp]);

  const estimate = useQuery({
    queryKey: ["vault", "storage_cost_estimate"],
    queryFn: () => view<string>("storage_cost_estimate").catch(() => FALLBACK_ESTIMATE),
    staleTime: 10 * 60_000,
  });
  const pre = useQuery({
    queryKey: ["preflight", w.accountId, form.origin],
    queryFn: () => preflight(w.accountId!, form.origin),
    enabled: !!w.accountId,
  });

  const txs = parsed.ok
    ? openTxs(parsed.terms, parsed.amount, pre.data?.prepaid ?? "0", pre.data?.estimate ?? estimate.data ?? FALLBACK_ESTIMATE)
    : [];
  const inTok = meta(table, form.origin);

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const review = () => {
    if (!w.accountId) return w.openPicker();
    const now = Date.now();                          // re-stamp expiry at the moment of review
    setStamp(now);
    const p = readForm(form, table, now);
    setSnap({
      signer: w.accountId,
      terms: p.terms, amount: p.amount,
      txs: openTxs(p.terms, p.amount, pre.data?.prepaid ?? "0", pre.data?.estimate ?? estimate.data ?? FALLBACK_ESTIMATE),
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Owner · NEAR mainnet · real funds</p>
        <h1 className="text-3xl font-semibold tracking-tight">Post a mandate</h1>
        <p className="max-w-2xl text-muted-foreground">
          Escrow an input token together with the worst all-in cost you will accept. From then on the bound is a
          condition the contract checks on every fill. Two transactions at most: prepay the storage your record
          will occupy, then transfer the input to the vault with your terms in <code>msg</code> — the transfer
          <i> is</i> the escrow. Both are shown in full, with the CLI equivalent, before anything is signed.
        </p>
      </header>

      {signed && <SigningResult signed={signed} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
            <CardDescription>Defaults are deliberately tiny: 0.01 wNEAR for USDT, 300 bps, 300 s, 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <TokenField label="You give" value={form.origin} onChange={set("origin")} table={table} />
              <TokenField label="You want" value={form.dest} onChange={set("dest")} table={table} />
            </div>
            {tokens.isError && (
              <p className="text-xs text-muted-foreground">
                1Click's token list is unavailable, so only the pair the vault is known to hold is offered.
              </p>
            )}
            <Field label="Amount to escrow" hint={`${inTok.symbol} · also the largest single fill`}>
              <Input inputMode="decimal" value={form.amount} onChange={(e) => set("amount")(e.target.value)} />
            </Field>
            {w.accountId && pre.data && inTok.dp !== null && (
              <p className="-mt-2 text-xs text-muted-foreground">
                you hold {units(pre.data.tokenBalance, inTok.dp, 6)} {inTok.symbol}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Worst all-in cost" hint="bps · 100 = 1%">
                <Input inputMode="numeric" value={form.bps} onChange={(e) => set("bps")(e.target.value)} />
              </Field>
              <Field label="Max quote age" hint="seconds">
                <Input inputMode="numeric" value={form.ageS} onChange={(e) => set("ageS")(e.target.value)} />
              </Field>
              <Field label="Expires in" hint="days">
                <Input inputMode="numeric" value={form.days} onChange={(e) => set("days")(e.target.value)} />
              </Field>
            </div>

            <dl className="divide-y rounded-md border px-3 text-sm">
              <Line k="storage estimate" v={estimate.data ? `${near(estimate.data, 5)} NEAR` : "…"} />
              <Line k="your prepaid storage" v={
                !w.accountId ? <span className="text-muted-foreground">connect to check</span>
                  : pre.data ? `${near(pre.data.prepaid, 5)} NEAR` : pre.isError ? "unavailable" : "…"} />
              <Line k="storage_deposit needed?" v={
                !w.accountId ? <span className="text-muted-foreground">assumed yes until connected</span>
                  : pre.data ? (txs.length > 1 ? "yes — first transaction" : "no — already prepaid") : "…"} />
            </dl>
            <p className="text-xs text-muted-foreground">
              The estimate is a recommendation, not a price: the vault charges the measured bytes each call writes,
              and anything left stays withdrawable with <code>storage_withdraw</code>.
            </p>

            {!parsed.ok && <p className="text-sm text-destructive">{parsed.error}</p>}
            {pre.isError && <p className="text-sm text-destructive">Could not check your account: {pre.error.message}</p>}

            <Button className="w-full" disabled={!parsed.ok || (!!w.accountId && !pre.data)} onClick={review}>
              {w.accountId ? `Review ${txs.length === 1 ? "the transaction" : `${txs.length} transactions`} and sign…` : "Connect a wallet to post"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>The exact transactions</CardTitle>
            <CardDescription>
              What the button will ask your wallet to sign, and the same thing as a command you can run instead —
              no wallet connection needed for that.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {parsed.ok ? <TxPreview txs={txs} signer={w.accountId} /> : <p className="text-sm text-muted-foreground">Fix the terms to see them.</p>}
          </CardContent>
        </Card>
      </div>

      {snap && (
        <ConfirmDialog
          snap={snap} table={table} onClose={() => setSnap(null)}
          onSigned={(hashes, pending) => setSigned({ cb: { kind: "signed", hashes }, pending })}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- confirmation */

function ConfirmDialog({ snap, table, onClose, onSigned }: {
  snap: Snapshot; table: TokenTable; onClose: () => void; onSigned: (hashes: string[], pending: Pending) => void;
}) {
  const w = useWallet();
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  // Re-check against the chain at the moment of confirming, not when the form was last edited.
  const pre = useQuery({
    queryKey: ["preflight", "confirm", snap.signer, snap.terms.origin_asset, snap.amount],
    queryFn: () => { forgetCache(); return preflight(snap.signer, snap.terms.origin_asset); },
    staleTime: 0,
  });
  const inTok = meta(table, snap.terms.origin_asset);
  const outTok = meta(table, snap.terms.destination_asset);
  const stop = pre.data ? blockers(pre.data, snap.txs, snap.amount, inTok.symbol, inTok.dp) : [];
  const storage = snap.txs.find((t) => t.actions[0].methodName === "storage_deposit");
  const signerChanged = w.accountId !== snap.signer;

  const sign = async () => {
    setSending(true);
    setError(null);
    const pending: Pending = { kind: "open", signer: snap.signer, txs: snap.txs, terms: snap.terms, amount: snap.amount, at: Date.now() };
    savePending(pending);                            // survives MyNearWallet's redirect
    try {
      const hashes = await w.signAndSend(snap.txs, `${location.origin}/post`);
      // Only Meteor gets here; MyNearWallet has navigated away.
      forgetCache();
      void qc.invalidateQueries({ queryKey: ["vault"] });
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
          <DialogTitle>Confirm before signing — NEAR mainnet</DialogTitle>
          <DialogDescription>
            Signed by <b>{snap.signer}</b>. Read every field below; this is exactly what your wallet will be asked
            to sign, nothing more.
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y rounded-md border px-3 text-sm">
          <Line k="escrowed into the vault" v={<b>{inTok.dp === null ? snap.amount : units(snap.amount, inTok.dp, 6)} {inTok.symbol}</b>} />
          <Line k="in exchange for" v={outTok.symbol} />
          <Line k="worst all-in cost" v={`${snap.terms.max_cost_bps} bps`} />
          <Line k="quotes older than" v={`${snap.terms.max_quote_age_secs} s are refused`} />
          <Line k="expires" v={new Date(Number(BigInt(snap.terms.expiry_ns) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 16) + " UTC"} />
          <Line k="storage prepaid" v={storage ? `${near(storage.actions[0].deposit, 5)} NEAR (withdrawable when unused)` : "none — already prepaid"} />
          <Line k="quote recipient" v={<code>{snap.terms.recipient}</code>} />
        </dl>

        <TxPreview txs={snap.txs} signer={snap.signer} />

        {pre.isPending && <p className="text-sm text-muted-foreground">Re-checking your balances on chain…</p>}
        {pre.isError && <p className="text-sm text-destructive">Could not re-check your account: {pre.error.message}</p>}
        {stop.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Not signing this</AlertTitle>
            <AlertDescription><ul className="list-disc pl-4">{stop.map((s) => <li key={s}>{s}</li>)}</ul></AlertDescription>
          </Alert>
        )}
        {signerChanged && <p className="text-sm text-destructive">The connected account changed. Close and review again.</p>}

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
          <span>
            I have read {snap.txs.length === 1 ? "this transaction" : `all ${snap.txs.length} transactions`} and
            want to sign {snap.txs.length === 1 ? "it" : "them"} on NEAR mainnet.
          </span>
        </label>
        {w.redirects && (
          <p className="text-xs text-muted-foreground">
            MyNearWallet signs on its own site: you will leave this page, sign there, and come back here, where the
            result is read from the chain.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error} — nothing was sent.</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={() => void sign()} disabled={!agreed || sending || !pre.data || stop.length > 0 || signerChanged}>
            {sending ? (w.redirects ? "Opening MyNearWallet…" : "Waiting for your wallet…") : `Sign ${snap.txs.length === 1 ? "1 transaction" : `${snap.txs.length} transactions`}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- the result */

interface Signed { cb: Callback; pending: Pending | null }

/**
 * Whatever came back — MyNearWallet's redirect or Meteor's hashes. The wallet's
 * parameters are removed from the URL so a reload does not replay them, the
 * pending record is cleared once it is held in state, and each hash's outcome
 * is read from the chain.
 */
function SigningResult({ signed }: { signed: Signed }) {
  const navigate = useNavigate();
  const w = useWallet();
  const qc = useQueryClient();
  const cb = signed;

  useEffect(() => {
    clearPending();
    if (readCallback(location.search)) navigate(withoutCallback(location.href), { replace: true });
  }, [signed, navigate]);

  const signer = cb.pending?.signer ?? w.accountId;
  const hashes = cb.cb.kind === "signed" ? cb.cb.hashes : [];
  const outcomes = useQueries({
    queries: hashes.map((h) => ({
      queryKey: ["tx", h, signer],
      queryFn: async () => interpret(await txOutcome(h, signer!)),
      enabled: !!signer,
      staleTime: Infinity,
      retry: false,
    })),
  });

  const anyOpened = outcomes.some((o) => o.data?.kind === "open" && o.data.ok);
  useEffect(() => {
    if (!anyOpened) return;
    forgetCache();
    void qc.invalidateQueries({ queryKey: ["vault"] });
  }, [anyOpened, qc]);

  if (cb.cb.kind === "error") {
    return (
      <Alert variant="destructive" className="mb-8">
        <AlertTitle>The wallet did not sign</AlertTitle>
        <AlertDescription>
          {cb.cb.message || cb.cb.code} ({cb.cb.code}). Nothing was sent.
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

function OutcomeLine({ r }: { r: ReturnType<typeof interpret> }) {
  if (r.kind === "storage_deposit") {
    return <><Badge className="bg-emerald-600">storage prepaid</Badge><span className="text-muted-foreground">balance now {near(r.credited, 5)} NEAR</span></>;
  }
  if (r.kind === "open" && r.ok) {
    return (
      <>
        <Badge className="bg-emerald-600">mandate opened</Badge>
        <Link className="underline" to={`/mandate/${r.mandateId}`}>Mandate #{r.mandateId} →</Link>
      </>
    );
  }
  if (r.kind === "open") {
    return <><Badge variant="destructive">not opened</Badge><span>{r.reason}. The token refunded the transfer.</span></>;
  }
  return r.ok ? <Badge variant="secondary">succeeded</Badge> : <><Badge variant="destructive">failed</Badge><span>{r.reason}</span></>;
}

/* ------------------------------------------------------------------ fields */

function TokenField({ label, value, onChange, table }: {
  label: string; value: string; onChange: (v: string) => void; table: TokenTable;
}) {
  const ids = Object.keys(table).sort((a, b) => table[a].symbol.localeCompare(table[b].symbol));
  if (!ids.includes(value)) ids.unshift(value);
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ids.map((id) => <SelectItem key={id} value={id}>{meta(table, id).symbol}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Line({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
