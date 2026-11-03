import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmTxDialog, SummaryRows, type Ask } from "@/components/ConfirmTxDialog";
import { SigningResult, useSigned } from "@/components/SigningResult";
import { TxPreview } from "@/components/TxPreview";
import { near, units, view, type MandateTerms, type Tx } from "@/lib/hallmark";
import {
  blockers, DEFAULTS, FALLBACK_ESTIMATE, openTxs, preflight, readForm, type FormInput,
} from "@/lib/post";
import { tokensQuery } from "@/lib/queries";
import { meta, type TokenTable } from "@/lib/tokens";
import { useWallet } from "@/wallet/WalletProvider";

export function PostPage() {
  const w = useWallet();
  const tokens = useQuery(tokensQuery);
  const table = useMemo(() => tokens.data ?? {}, [tokens.data]);

  const [signed, setSigned] = useSigned();

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

  const [ask, setAsk] = useState<Ask | null>(null);
  const review = () => {
    if (!w.accountId) return w.openPicker();
    const now = Date.now();                          // re-stamp expiry at the moment of review
    setStamp(now);
    const p = readForm(form, table, now);
    const signer = w.accountId;
    const frozen = openTxs(p.terms, p.amount, pre.data?.prepaid ?? "0", pre.data?.estimate ?? estimate.data ?? FALLBACK_ESTIMATE);
    setAsk(postAsk(signer, p.terms, p.amount, frozen, table));
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

      {ask && (
        <ConfirmTxDialog
          ask={ask} onClose={() => setAsk(null)}
          onSigned={(hashes, pending) => setSigned({ cb: { kind: "signed", hashes }, pending })}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- confirmation */

/** The open, as the shared confirm dialog asks it: summary, frozen txs, a fresh chain check. */
function postAsk(
  signer: string, terms: MandateTerms, amount: string,
  txs: Tx[], table: TokenTable,
): Ask {
  const inTok = meta(table, terms.origin_asset);
  const outTok = meta(table, terms.destination_asset);
  const storage = txs.find((t) => t.actions[0].methodName === "storage_deposit");
  return {
    kind: "open",
    title: "Confirm before signing",
    signer, txs,
    returnPath: "/post",
    summary: (
      <SummaryRows rows={{
        "escrowed into the vault": <b>{inTok.dp === null ? amount : units(amount, inTok.dp, 6)} {inTok.symbol}</b>,
        "in exchange for": outTok.symbol,
        "worst all-in cost": `${terms.max_cost_bps} bps`,
        "quotes older than": `${terms.max_quote_age_secs} s are refused`,
        "expires": new Date(Number(BigInt(terms.expiry_ns) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 16) + " UTC",
        "storage prepaid": storage ? `${near(storage.actions[0].deposit, 5)} NEAR (withdrawable when unused)` : "none — already prepaid",
        "quote recipient": <code>{terms.recipient}</code>,
      }} />
    ),
    check: async () => blockers(await preflight(signer, terms.origin_asset), txs, amount, inTok.symbol, inTok.dp),
  };
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
