import { useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmTxDialog, SummaryRows, type Ask } from "@/components/ConfirmTxDialog";
import { MandateCard } from "@/components/MandateCard";
import { SigningResult, useSigned } from "@/components/SigningResult";
import {
  loadAccount, cancelTxs, fundRefusal, fundTxs, reapTxs, storageWithdrawTxs, withdrawTxs,
  type AccountSnapshot, type Credit, type OwnedMandate, type Progress,
} from "@/lib/account";
import { EXPLORER, near, parseUnits, short, tokenOf, units, view, viewOn, type MandateRecord } from "@/lib/hallmark";
import { depositBlocker, FALLBACK_ESTIMATE, nearAvailable } from "@/lib/post";
import { tokensQuery } from "@/lib/queries";
import { FLOOR, meta, type TokenMeta, type TokenTable } from "@/lib/tokens";
import { useWallet } from "@/wallet/WalletProvider";

/** NEAR account ids: 2–64 chars, lowercase, `.`-separated parts of [a-z0-9] joined by `-`/`_`. */
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/* ------------------------------------------------------------- /account */

export function AccountIndex() {
  const w = useWallet();
  const navigate = useNavigate();
  const [v, setV] = useState("");
  if (w.accountId) return <Navigate to={`/account/${w.accountId}`} replace />;
  const go = () => { const id = v.trim().toLowerCase(); if (ACCOUNT.test(id)) navigate(`/account/${id}`); };
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">An account's position</h1>
      <p className="mb-6 text-muted-foreground">
        Everything the vault holds for, and owes, any account — readable without a wallet.
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Input placeholder="yourname.near" value={v} onChange={(e) => setV(e.target.value)} spellCheck={false} />
        <Button type="submit" disabled={!ACCOUNT.test(v.trim().toLowerCase())}>Look it up</Button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        or <button className="underline" onClick={w.openPicker}>connect a wallet</button> to see your own.
      </p>
    </div>
  );
}

/* ------------------------------------------------------- /account/:id */

export function AccountPage() {
  const id = (useParams().id ?? "").toLowerCase();
  const w = useWallet();
  const tokens = useQuery(tokensQuery);
  const [signed, setSigned] = useSigned();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  // Wait for 1Click's real list (not the placeholder floor) before scanning;
  // if 1Click is down, scan the floor and say so.
  const listReady = (tokens.isSuccess && !tokens.isPlaceholderData) || tokens.isError;
  const table: TokenTable = useMemo(() => (tokens.isError ? FLOOR : tokens.data ?? FLOOR), [tokens.isError, tokens.data]);
  const listed = useMemo(() => Object.keys(table).sort(), [table]);

  const snap = useQuery({
    queryKey: ["account", id, listed.length],
    queryFn: () => loadAccount(id, listed, setProgress),
    enabled: ACCOUNT.test(id) && listReady,
    staleTime: 30_000,
  });
  const estimate = useQuery({
    queryKey: ["vault", "storage_cost_estimate"],
    queryFn: () => view<string>("storage_cost_estimate").catch(() => FALLBACK_ESTIMATE),
    staleTime: 10 * 60_000,
  });

  if (!ACCOUNT.test(id)) {
    return <Page id={id}><Problem title="Not a NEAR account id">Account ids are lowercase, like <code>name.near</code>.</Problem></Page>;
  }

  const isMe = w.accountId === id;
  const s = snap.data;
  const open = s?.mandates.filter((o) => o.m.open) ?? [];
  const closed = s?.mandates.filter((o) => !o.m.open) ?? [];
  const asks = s ? actions(id, s, table, estimate.data ?? FALLBACK_ESTIMATE) : null;

  return (
    <Page id={id}>
      {signed && <SigningResult signed={signed} />}

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        {isMe ? <Badge>this is your connected account</Badge>
          : <Badge variant="outline">read-only — {w.accountId ? `connected as ${short(w.accountId, 10)}` : "no wallet connected"}</Badge>}
        {s && <span className="text-muted-foreground">read at block {s.blockHeight.toLocaleString()} · scanned {s.scanned} mandate ids · {listed.length} assets</span>}
        <Button variant="outline" size="sm" onClick={() => void snap.refetch()} disabled={snap.isFetching}>
          <RefreshCw className={snap.isFetching ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {tokens.isError && (
        <Alert className="mb-6">
          <AlertTitle>1Click's token list is unavailable</AlertTitle>
          <AlertDescription>
            Credits were checked only for wNEAR, USDT and the assets of this account's own mandates. A credit in any
            other token would not show here.
          </AlertDescription>
        </Alert>
      )}

      {(snap.isPending || !listReady) && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {!listReady ? "fetching the token list…"
              : progress ? `reading the chain… ${progress.done} of ${progress.total} views` : "reading the chain…"}
          </p>
          <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        </div>
      )}
      {snap.isError && <Problem title="Could not read this account">{snap.error.message}</Problem>}

      {s && asks && (
        <div className="space-y-8">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Withdrawable credits</CardTitle>
                <CardDescription>
                  Payouts are pull, never push: a fill credits the filler the input and the owner the output, a
                  cancel credits the unspent escrow, and nothing moves until it is withdrawn.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {s.credits.length === 0 && <p className="text-sm text-muted-foreground">Nothing owed to this account.</p>}
                {s.credits.map((c) => (
                  <div key={c.asset} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                    <AmountOf v={c.amount} tok={meta(table, c.asset)} />
                    <Button size="sm" onClick={() => setAsk(asks.withdraw(c))}>Withdraw</Button>
                  </div>
                ))}
                {s.creditErrors.length > 0 && (
                  <p className="text-xs text-destructive">
                    {s.creditErrors.length} asset{s.creditErrors.length === 1 ? "" : "s"} could not be read; refresh to retry.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Prepaid storage</CardTitle>
                <CardDescription>
                  NEAR prepaid against the state this account creates. The vault charges the measured bytes each call
                  writes and refunds what reaping frees; what is left is withdrawable.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <span className="text-xl font-semibold">{near(s.storage, 5)} NEAR</span>
                <Button size="sm" disabled={BigInt(s.storage) === 0n} onClick={() => setAsk(asks.storageWithdraw())}>
                  Withdraw all
                </Button>
              </CardContent>
            </Card>
          </div>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Open mandates <span className="text-muted-foreground">({open.length})</span></h2>
            {open.length === 0 && <p className="text-sm text-muted-foreground">None open. <Link className="underline" to="/post">Post one →</Link></p>}
            <div className="grid gap-4 md:grid-cols-2">
              {open.map((o) => (
                <div key={o.id} className="space-y-2">
                  <MandateCard id={o.id} m={o.m} table={table} readAt={snap.dataUpdatedAt} link />
                  <OpenActions o={o} table={table} asks={asks} onAsk={setAsk} readAt={snap.dataUpdatedAt} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Closed, not yet reaped <span className="text-muted-foreground">({closed.length})</span></h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              A closed mandate's record stays as its own receipt until the owner reaps it; reaping deletes it and
              returns the storage it frees to the owner's prepaid balance.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {closed.map((o) => (
                <div key={o.id} className="space-y-2">
                  <MandateCard id={o.id} m={o.m} table={table} readAt={snap.dataUpdatedAt} />
                  <Button variant="outline" size="sm" onClick={() => setAsk(asks.reap(o))}>Reap #{o.id}</Button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {ask && (
        <ConfirmTxDialog
          ask={ask} onClose={() => setAsk(null)}
          onSigned={(hashes, pending) => setSigned({ cb: { kind: "signed", hashes }, pending })}
        />
      )}
    </Page>
  );
}

function OpenActions({ o, table, asks, onAsk, readAt }: {
  o: OwnedMandate; table: TokenTable; asks: Actions; onAsk: (a: Ask) => void; readAt: number;
}) {
  const tok = meta(table, o.m.terms.origin_asset);
  const [amt, setAmt] = useState("0.01");
  const refusal = fundRefusal(o, readAt);
  let parsed: { ok: true; v: string } | { ok: false; e: string };
  try {
    if (tok.dp === null) throw new Error("decimals unknown");
    const v = parseUnits(amt || "0", tok.dp);
    parsed = v === "0" ? { ok: false, e: "above zero" } : { ok: true, v };
  } catch (e) { parsed = { ok: false, e: (e as Error).message }; }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
      <Button variant="outline" size="sm" onClick={() => onAsk(asks.cancel(o))}>Cancel #{o.id}</Button>
      <span className="flex-1" />
      {refusal ? <span className="text-xs text-muted-foreground">top-up unavailable: {refusal}</span> : (
        <>
          <Input className="h-8 w-28" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="top-up amount" />
          <span className="text-muted-foreground">{tok.symbol}</span>
          <Button size="sm" disabled={!parsed.ok} title={parsed.ok ? "" : parsed.e} onClick={() => parsed.ok && onAsk(asks.fund(o, parsed.v))}>
            Top up
          </Button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- asks */

type Actions = ReturnType<typeof actions>;

/**
 * Every action on this page, as the shared confirm dialog asks it. Each check
 * re-reads the chain when the dialog opens, so a stale page cannot talk the
 * user into a transaction the contract would refuse.
 */
function actions(account: string, s: AccountSnapshot, table: TokenTable, estimate: string) {
  const ret = `/account/${account}`;
  const nearCheck = async (txs: Ask["txs"]) => {
    const b = depositBlocker(await nearAvailable(account), txs);
    return b ? [b] : [];
  };
  const fresh = (id: number) => view<MandateRecord | null>("get_mandate", { mandate_id: id });

  return {
    withdraw(c: Credit): Ask {
      const tok = meta(table, c.asset);
      const txs = withdrawTxs(c);
      return {
        kind: "withdraw", title: `Withdraw ${tok.symbol}`, signer: account, txs, returnPath: ret,
        summary: <SummaryRows rows={{
          "paid out to": <code>{account}</code>,
          "amount": <AmountOf v={c.amount} tok={tok} />,
          "token contract": <code>{tokenOf(c.asset)}</code>,
        }} />,
        check: async () => {
          const out = await nearCheck(txs);
          const now = await view<string>("get_credit", { account_id: account, asset: c.asset });
          if (BigInt(now) === 0n) out.push("this credit has already been withdrawn.");
          // A payout to an account not registered on the token fails; the vault
          // restores the credit, but the gas is spent. Tokens that do not
          // implement storage_balance_of are not judged.
          const reg = await viewOn<unknown>(tokenOf(c.asset), "storage_balance_of", { account_id: account }).catch(() => undefined);
          if (reg === null) out.push(`${account} is not registered on ${tokenOf(c.asset)}, so the payout would fail and the credit be restored. Register with storage_deposit on that token first.`);
          return out;
        },
      };
    },

    storageWithdraw(): Ask {
      const txs = storageWithdrawTxs();
      return {
        kind: "storage_withdraw", title: "Withdraw prepaid storage", signer: account, txs, returnPath: ret,
        summary: <SummaryRows rows={{
          "paid out to": <code>{account}</code>,
          "amount": `all of it — ${near(s.storage, 5)} NEAR as last read`,
          "afterwards": "posting, filling or cancelling will need a new storage_deposit",
        }} />,
        check: async () => {
          const out = await nearCheck(txs);
          if (BigInt(await view<string>("storage_balance_of", { account_id: account })) === 0n) out.push("there is no prepaid storage to withdraw.");
          return out;
        },
      };
    },

    cancel(o: OwnedMandate): Ask {
      const tok = meta(table, o.m.terms.origin_asset);
      const txs = cancelTxs(o, s, estimate);
      const deposit = txs.find((t) => t.actions[0].methodName === "storage_deposit");
      return {
        kind: "cancel", title: `Cancel mandate #${o.id}`, signer: account, txs, returnPath: ret,
        summary: <SummaryRows rows={{
          "closes": `mandate #${o.id} — no further fills`,
          "unspent escrow": <><AmountOf v={o.m.escrow} tok={tok} /> becomes a withdrawable credit</>,
          "fills already settled": "untouched",
          "storage": deposit
            ? `${near(deposit.actions[0].deposit, 5)} NEAR prepaid first: returning the escrow writes a credit slot`
            : "covered by your prepaid balance",
          "afterwards": "the record stays until you reap it",
        }} />,
        check: async () => {
          const out = await nearCheck(txs);
          const m = await fresh(o.id);
          if (!m) out.push("this mandate no longer exists.");
          else if (!m.open) out.push("this mandate is already closed.");
          else if (m.owner !== account) out.push("only the owner can cancel.");
          return out;
        },
      };
    },

    reap(o: OwnedMandate): Ask {
      const txs = reapTxs(o);
      return {
        kind: "reap", title: `Reap mandate #${o.id}`, signer: account, txs, returnPath: ret,
        summary: <SummaryRows rows={{
          "deletes": `the record of closed mandate #${o.id} — its receipt goes with it`,
          "returns": "the storage it frees, measured, to your prepaid balance",
        }} />,
        check: async () => {
          const out = await nearCheck(txs);
          const m = await fresh(o.id);
          if (!m) out.push("this record has already been reaped.");
          else if (m.open) out.push("cancel the mandate first.");
          return out;
        },
      };
    },

    fund(o: OwnedMandate, amount: string): Ask {
      const tok = meta(table, o.m.terms.origin_asset);
      const txs = fundTxs(o, amount);
      return {
        kind: "fund", title: `Top up mandate #${o.id}`, signer: account, txs, returnPath: ret,
        summary: <SummaryRows rows={{
          "added to escrow": <b><AmountOf v={amount} tok={tok} /></b>,
          "escrow afterwards": <AmountOf v={(BigInt(o.m.escrow) + BigInt(amount)).toString()} tok={tok} />,
          "terms": "unchanged — same ceiling, max fill, age bound and expiry",
        }} />,
        check: async () => {
          const out = await nearCheck(txs);
          const m = await fresh(o.id);
          const why = m ? fundRefusal({ id: o.id, m }, Date.now()) : "the mandate no longer exists";
          if (why) out.push(`the contract would refuse this: ${why}.`);
          const bal = await viewOn<string>(tokenOf(o.m.terms.origin_asset), "ft_balance_of", { account_id: account });
          if (BigInt(bal) < BigInt(amount)) out.push(`you hold ${tok.dp === null ? bal : units(bal, tok.dp, 6)} ${tok.symbol}, less than the top-up.`);
          return out;
        },
      };
    },
  };
}

/* ------------------------------------------------------------- bits */

function Page({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-6 space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Position · NEAR mainnet</p>
        <h1 className="break-all text-3xl font-semibold tracking-tight">
          <a className="hover:underline" href={`${EXPLORER}/address/${id}`} target="_blank" rel="noreferrer">{id}</a>
        </h1>
      </header>
      {children}
    </div>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function AmountOf({ v, tok }: { v: string; tok: TokenMeta }) {
  return tok.dp === null
    ? <span>{v} <span className="text-muted-foreground">base units of {tok.symbol}</span></span>
    : <span title={`${v} base units`}>{units(v, tok.dp, 6)} <span className="text-muted-foreground">{tok.symbol}</span></span>;
}
