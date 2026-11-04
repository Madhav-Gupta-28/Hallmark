import { useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ConfirmTxDialog, SummaryRows, type Ask } from "@/components/ConfirmTxDialog";
import { Entry, Heading, L, Seal, Source, Stamp } from "@/components/doc";
import { SigningResult } from "@/components/SigningResult";
import { useSigned } from "@/lib/signed";
import {
  loadAccount, cancelTxs, fundRefusal, fundTxs, reapTxs, storageWithdrawTxs, withdrawTxs,
  type AccountSnapshot, type Credit, type OwnedMandate, type Progress,
} from "@/lib/account";
import { age, EXPLORER, near, parseUnits, short, tokenOf, units, view, viewOn, type MandateRecord } from "@/lib/hallmark";
import { depositBlocker, FALLBACK_ESTIMATE, nearAvailable } from "@/lib/post";
import { tokensQuery } from "@/lib/queries";
import { FLOOR, meta, type TokenMeta, type TokenTable } from "@/lib/tokens";
import { useWallet } from "@/wallet/context";

/** NEAR account ids: 2–64 chars, lowercase, `.`-separated parts of [a-z0-9] joined by `-`/`_`. */
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

const NS_PER_DAY = 86_400_000_000_000n;

/* ------------------------------------------------------------- /account */

export function AccountIndex() {
  const w = useWallet();
  const navigate = useNavigate();
  const [v, setV] = useState("");
  if (w.accountId) return <Navigate to={`/account/${w.accountId}`} replace />;
  const id = v.trim().toLowerCase();
  const go = () => { if (ACCOUNT.test(id)) navigate(`/account/${id}`); };
  return (
    <main className="doc pt-10">
      <div className="label text-faint">Statement of account</div>
      <h1 className="mt-3 font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
        Whose statement?
      </h1>
      <form className="mt-8 text-[clamp(20px,2.4vw,26px)] leading-[2]" onSubmit={(e) => { e.preventDefault(); go(); }}>
        Prepare the statement of account for{" "}
        <input className="blank" style={{ width: "18ch" }} placeholder="name.near" value={v}
          onChange={(e) => setV(e.target.value)} spellCheck={false} aria-label="account id"
          aria-invalid={v.length > 0 && !ACCOUNT.test(id)} />{" "}
        <button type="submit" className="btn btn-ink ml-2 align-middle" disabled={!ACCOUNT.test(id)}>prepare</button>
      </form>
      <p className="mt-6 text-[18px]">
        Any account's statement can be read without a wallet. Or{" "}
        <button className="lnk" onClick={w.openPicker}>connect</button> to see — and act on — your own.
      </p>
    </main>
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
    return (
      <main className="doc flex flex-col items-start gap-8 py-14 sm:flex-row sm:items-center">
        <Seal slam top="refused" big="?" bottom="no such account" size={160} />
        <div>
          <h1 className="font-serif text-[clamp(30px,5vw,56px)] font-extrabold leading-none">Not a NEAR account id.</h1>
          <p className="mt-4 text-[19px]">Account ids are lowercase, like <code>name.near</code>. <L to="/account">Try another.</L></p>
        </div>
      </main>
    );
  }

  const isMe = w.accountId === id;
  const s = snap.data;
  const open = s?.mandates.filter((o) => o.m.open) ?? [];
  const closed = s?.mandates.filter((o) => !o.m.open) ?? [];
  const asks = s ? actions(id, s, table, estimate.data ?? FALLBACK_ESTIMATE) : null;
  const readAt = snap.dataUpdatedAt;

  return (
    <main className="doc">
      {signed && <SigningResult signed={signed} />}

      <section className="relative pt-10">
        <div className="label text-faint">Statement of account · NEAR mainnet</div>
        <h1 className={id.length > 32
          ? "typed mt-3 break-all text-[clamp(20px,2.6vw,32px)] font-bold leading-tight"
          : "mt-3 break-all font-serif text-[clamp(32px,5.6vw,72px)] font-extrabold leading-[0.98] tracking-[-0.02em]"}>
          <a href={`${EXPLORER}/address/${id}`} target="_blank" rel="noreferrer" className="hover:bg-hl">{id}</a>
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          {isMe
            ? <Stamp ink="blue">your account · you may act on it</Stamp>
            : <Stamp ink="blue" tilt={0}>read only{w.accountId ? ` · you are ${short(w.accountId, 8)}` : " · no wallet connected"}</Stamp>}
          <button className="btn btn-sm" onClick={() => void snap.refetch()} disabled={snap.isFetching}>
            {snap.isFetching ? "reading…" : "re-read the chain"}
          </button>
          {s && <span className="typed text-[13px] text-faint">as at block {s.blockHeight.toLocaleString()} · {s.scanned} agreement{s.scanned === 1 ? "" : "s"} and {listed.length} tokens examined</span>}
        </div>
      </section>

      {tokens.isError && (
        <p className="mt-6 max-w-[760px] border-l-4 border-seal pl-4 text-[17px]">
          1Click's token list is unavailable, so credits were checked only for wNEAR, USDT and this account's own
          agreements' tokens. A credit in any other token would not appear here.
        </p>
      )}

      {(snap.isPending || !listReady) && (
        <p className="typed mt-10 text-[15px] text-faint">
          {!listReady ? "fetching the token list…"
            : progress ? `examining the chain… ${progress.done} of ${progress.total} entries` : "examining the chain…"}
        </p>
      )}
      {snap.isError && <p className="typed mt-10 text-seal">This statement could not be prepared: {snap.error.message}</p>}

      {s && asks && (
        <>
          <Heading kicker="Part I">Owed to this account</Heading>
          <p className="mb-4 max-w-[760px] text-[17px]">
            Payouts are pulled, never pushed. A fill credits the filler the input and the owner the output, a cancel
            credits the unspent escrow — and nothing moves until it is withdrawn.
          </p>
          {s.credits.length === 0
            ? <p className="text-[19px]">Nothing is owed to this account.</p>
            : (
              <table className="ledger">
                <thead><tr><th>Token</th><th className="text-right">Amount owed</th><th /></tr></thead>
                <tbody>
                  {s.credits.map((c) => {
                    const tok = meta(table, c.asset);
                    return (
                      <tr key={c.asset}>
                        <td className="font-semibold">{tok.symbol} <span className="typed text-[13px] font-normal text-faint">{tokenOf(c.asset)}</span></td>
                        <td className="num text-[18px] font-bold"><AmountOf v={c.amount} tok={tok} /></td>
                        <td className="text-right"><button className="btn btn-sm btn-sign" onClick={() => setAsk(asks.withdraw(c))}>withdraw</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          {s.creditErrors.length > 0 && (
            <p className="typed mt-3 text-[13px] text-seal">
              {s.creditErrors.length} token{s.creditErrors.length === 1 ? "" : "s"} could not be read — unknown, not zero. Re-read to retry.
            </p>
          )}

          <Heading kicker="Part II">Prepaid storage</Heading>
          <div className="flex flex-wrap items-center justify-between gap-6">
            <p className="max-w-[640px] text-[17px]">
              NEAR prepaid against the state this account writes. The vault charges the measured bytes and refunds what
              reaping frees; the rest is this account's to take back.
            </p>
            <div className="flex items-center gap-5">
              <span className="typed text-[26px] font-bold">{near(s.storage, 5)} NEAR</span>
              <button className="btn btn-sm" disabled={BigInt(s.storage) === 0n} onClick={() => setAsk(asks.storageWithdraw())}>withdraw all</button>
            </div>
          </div>

          <Heading kicker="Part III">Agreements in force <span className="typed text-[0.5em] text-faint">({open.length})</span></Heading>
          {open.length === 0 && <p className="text-[19px]">None in force. <L to="/post">Draw one up.</L></p>}
          {open.map((o) => <Held key={o.id} o={o} table={table} readAt={readAt}>
            <OpenActions o={o} table={table} asks={asks} onAsk={setAsk} readAt={readAt} />
          </Held>)}

          <Heading kicker="Part IV">Closed, awaiting reaping <span className="typed text-[0.5em] text-faint">({closed.length})</span></Heading>
          <p className="mb-2 max-w-[760px] text-[17px]">
            A closed agreement's record stays as its own receipt until the owner reaps it. Reaping deletes the record
            and returns the storage it frees to the prepaid balance.
          </p>
          {closed.length === 0 && <p className="text-[19px]">None.</p>}
          {closed.map((o) => <Held key={o.id} o={o} table={table} readAt={readAt}>
            <button className="btn btn-sm" onClick={() => setAsk(asks.reap(o))}>reap §{o.id}</button>
          </Held>)}

          <Source>
            get_mandate(1…{s.scanned}), get_credit × {listed.length}, storage_balance_of — every read pinned to block{" "}
            {s.blockHeight.toLocaleString()} so this statement is consistent with itself.{" "}
            {!isMe && "Actions open the execution page so anyone can read the exact transaction; only this account can sign."}
          </Source>
        </>
      )}

      {ask && (
        <ConfirmTxDialog
          ask={ask} onClose={() => setAsk(null)}
          onSigned={(hashes, pending) => setSigned({ cb: { kind: "signed", hashes }, pending })}
        />
      )}
    </main>
  );
}

/** One agreement on the statement: a single ruled entry, its numbers, and what can be done with it. */
function Held({ o, table, readAt, children }: { o: OwnedMandate; table: TokenTable; readAt: number; children: ReactNode }) {
  const t = o.m.terms;
  const inTok = meta(table, t.origin_asset);
  const outTok = meta(table, t.destination_asset);
  const left = (BigInt(t.expiry_ns) - BigInt(readAt) * 1_000_000n) / NS_PER_DAY;
  return (
    <div className="grid gap-x-8 gap-y-3 border-b border-ink py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div>
        <L to={`/mandate/${o.id}`} className="font-serif text-[26px] font-extrabold no-underline hover:underline">
          §{o.id} · {inTok.symbol} for {outTok.symbol}
        </L>
        <p className="typed mt-1 text-[14px] text-faint">
          ceiling {t.max_cost_bps} bps · worst taken {o.m.fills ? `${o.m.worst_bps} bps` : "—"} · {o.m.fills} fill{o.m.fills === 1 ? "" : "s"} ·
          fresher than {age(t.max_quote_age_secs)} · {o.m.open ? (left > 0n ? `${left} days left` : "expired") : "closed"}
        </p>
      </div>
      <div>
        <Entry k="Escrow" v={<span className="typed"><AmountOf v={o.m.escrow} tok={inTok} /></span>} />
        <Entry k="Delivered" v={<span className="typed"><AmountOf v={o.m.delivered} tok={outTok} /></span>} />
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">{children}</div>
      </div>
    </div>
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
    <>
      {refusal ? <span className="typed text-[13px] text-faint">no top-up: {refusal}</span> : (
        <span className="text-[17px]">
          top up by{" "}
          <input className="blank" style={{ width: "7ch" }} inputMode="decimal" value={amt} aria-label="top-up amount"
            aria-invalid={!parsed.ok} onChange={(e) => setAmt(e.target.value)} />{" "}
          <span className="typed">{tok.symbol}</span>{" "}
          <button className="btn btn-sm btn-sign ml-1" disabled={!parsed.ok} title={parsed.ok ? "" : parsed.e}
            onClick={() => parsed.ok && onAsk(asks.fund(o, parsed.v))}>top up</button>
        </span>
      )}
      <button className="btn btn-sm" onClick={() => onAsk(asks.cancel(o))}>cancel §{o.id}</button>
    </>
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
        kind: "cancel", title: `Cancel agreement §${o.id}`, signer: account, txs, returnPath: ret,
        summary: <SummaryRows rows={{
          "closes": `agreement §${o.id} — no further fills`,
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
        kind: "reap", title: `Reap agreement §${o.id}`, signer: account, txs, returnPath: ret,
        summary: <SummaryRows rows={{
          "deletes": `the record of closed agreement §${o.id} — its receipt goes with it`,
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
        kind: "fund", title: `Top up agreement §${o.id}`, signer: account, txs, returnPath: ret,
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

function AmountOf({ v, tok }: { v: string; tok: TokenMeta }) {
  return tok.dp === null
    ? <span>{v} <span className="text-faint">base units of {tok.symbol}</span></span>
    : <span title={`${v} base units`}>{units(v, tok.dp, 6)} <span className="text-faint">{tok.symbol}</span></span>;
}
