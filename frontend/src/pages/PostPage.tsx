import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ConfirmTxDialog, SummaryRows, type Ask } from "@/components/ConfirmTxDialog";
import { Clause, Entry, Heading, Source } from "@/components/doc";
import { SigningResult } from "@/components/SigningResult";
import { useSigned } from "@/lib/signed";
import { TxPreview } from "@/components/TxPreview";
import {
  canonicalise, getQuote, near, units, VAULT, view, type MandateTerms, type Tx,
} from "@/lib/hallmark";
import {
  blockers, DEFAULTS, FALLBACK_ESTIMATE, NS_PER_DAY, openTxs, preflight, readForm, wrapsNear,
  type FormInput,
} from "@/lib/post";
import { tokensQuery } from "@/lib/queries";
import { meta, type TokenTable } from "@/lib/tokens";
import { useWallet } from "@/wallet/context";

/** Which blank an error from `readForm` is about, so that blank can be marked in red. */
function blameOf(error: string | null): keyof FormInput | "pair" | null {
  if (!error) return null;
  if (/asset|differ|nep141/.test(error)) return "pair";
  if (/ceiling/.test(error)) return "bps";
  if (/freshness/.test(error)) return "ageS";
  if (/expiry/.test(error)) return "days";
  return "amount";
}

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
  const blame = blameOf(parsed.ok ? null : parsed.error);

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
    ? openTxs(parsed.terms, parsed.amount, pre.data?.prepaid ?? "0", pre.data?.estimate ?? estimate.data ?? FALLBACK_ESTIMATE, pre.data)
    : [];
  const inTok = meta(table, form.origin);
  const days = Number(form.days);
  const expiry = Number.isInteger(days) && days > 0
    ? new Date(Number((BigInt(stamp) * 1_000_000n + BigInt(days) * NS_PER_DAY) / 1_000_000n)).toISOString().slice(0, 10)
    : "—";

  const [ask, setAsk] = useState<Ask | null>(null);
  const review = () => {
    if (!w.accountId) return w.openPicker();
    const now = Date.now();                          // re-stamp expiry at the moment of review
    setStamp(now);
    const p = readForm(form, table, now);
    const frozen = openTxs(p.terms, p.amount, pre.data?.prepaid ?? "0", pre.data?.estimate ?? estimate.data ?? FALLBACK_ESTIMATE, pre.data);
    setAsk(postAsk(w.accountId, p.terms, p.amount, frozen, table));
  };

  const blank = (k: keyof FormInput, width: string, mode: "decimal" | "numeric") => (
    <input
      className="blank" style={{ width }} inputMode={mode} value={form[k]} aria-label={k}
      aria-invalid={blame === k} onChange={(e) => set(k)(e.target.value)} spellCheck={false}
    />
  );

  return (
    <main className="doc">
      {signed && <SigningResult signed={signed} />}

      <section className="pt-10">
        <div className="label text-faint">Draw up an agreement · NEAR mainnet · real funds</div>
        <h1 className="mt-3 font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
          Put your terms <span className="hl">in writing.</span>
        </h1>
        <p className="mt-5 max-w-[700px] text-[19px]">
          Fill in the blanks. From the moment you sign, the bound is not a promise anyone made you — it is a condition
          the contract checks on every fill, and cannot be talked out of. The defaults are deliberately tiny.
        </p>
      </section>

      <Heading kicker="The agreement">Agreement to exchange</Heading>
      <div className="text-[clamp(19px,2.2vw,24px)] leading-[2.1]">
        <p>
          I, <span className="hand text-[1.3em]">{w.accountId ?? "the undersigned"}</span>, escrow{" "}
          {blank("amount", "7ch", "decimal")}{" "}
          <TokenBlank value={form.origin} onChange={set("origin")} table={table} invalid={blame === "pair"} />{" "}
          with <code className="text-[0.8em]">{VAULT}</code>, to be exchanged for{" "}
          <TokenBlank value={form.dest} onChange={set("dest")} table={table} invalid={blame === "pair"} />.
        </p>
      </div>
      {w.accountId && pre.data && inTok.dp !== null && (
        <p className="typed text-[13px] text-faint">↳ you hold {units(pre.data.tokenBalance, inTok.dp, 6)} {inTok.symbol}</p>
      )}
      {tokens.isError && (
        <p className="typed text-[13px] text-faint">↳ 1Click's token list is unavailable, so only the pair the vault is known to hold is offered.</p>
      )}

      <div className="mt-6 text-[clamp(18px,2vw,21px)]">
        <Clause no="§1" title="Ceiling">
          I will pay no more than {blank("bps", "6ch", "numeric")} basis points all-in on any fill
          <span className="typed text-[0.75em] text-faint"> (100 = 1%)</span>, measured on what actually arrives.
          <MarketReference
            origin={form.origin} dest={form.dest}
            amount={parsed.ok ? parsed.amount : null} ceiling={Number(form.bps)}
            onUse={(bps) => set("bps")(String(bps))}
          />
        </Clause>
        <Clause no="§1a" title="Size">
          Any filler may take up to the whole escrow in a single fill.
        </Clause>
        <Clause no="§3" title="Freshness">
          No quote signed more than {blank("ageS", "6ch", "numeric")} seconds before the fill shall be honoured.
        </Clause>
        <Clause no="§7" title="Term">
          This agreement expires in {blank("days", "4ch", "numeric")} days, on <b className="typed text-sign">{expiry}</b>.
        </Clause>
        <Clause no="§8" title="Recipient">
          Every quote must name <code>{VAULT}</code> as its recipient — the vault, never me, or the contract refuses
          to open the agreement.
        </Clause>
      </div>
      {!parsed.ok && <p className="mt-4 text-[18px]"><span className="stamp mr-2">defect</span> {parsed.error}</p>}

      <Heading kicker="Schedule C">Storage</Heading>
      <div className="grid gap-x-12 md:grid-cols-2">
        <div>
          <Entry k="Recommended prepayment" v={<span className="typed">{estimate.data ? `${near(estimate.data, 5)} NEAR` : "…"}</span>} />
          <Entry k="Already prepaid by you" v={<span className="typed">{!w.accountId ? "connect to check" : pre.data ? `${near(pre.data.prepaid, 5)} NEAR` : pre.isError ? "unavailable" : "…"}</span>} />
          <Entry k="storage_deposit first?" v={<span className="typed">{!w.accountId ? "assumed yes" : pre.data ? (txs.some((t) => t.receiverId === VAULT) ? "yes" : "no — already prepaid") : "…"}</span>} />
          {wrapsNear(txs) && (
            <Entry k="wNEAR to mint first" v={<span className="typed text-sign">
              {near(txs.find((t) => wrapsNear([t]))!.actions[0].deposit, 5)} NEAR → wNEAR, in this batch
            </span>} />
          )}
        </div>
        <p className="py-2 text-[17px]">
          Whoever causes a byte to be written pays for that byte. The estimate is a recommendation, not a price: the
          vault charges what your record actually measures, and the rest stays yours to withdraw.
        </p>
      </div>
      {pre.isError && <p className="typed mt-3 text-[14px] text-seal">Could not read your account: {pre.error.message}</p>}

      <section className="mt-14 flex flex-wrap items-end justify-between gap-8 border-t-[6px] border-double border-ink pt-8">
        <div className="min-w-[260px] flex-1">
          <div className="hand text-[30px] leading-none">{w.accountId ?? " "}</div>
          <div className="sigline mt-1">Signature of the owner · applied by your wallet, after you read every byte</div>
        </div>
        <button className="btn btn-sign" disabled={!parsed.ok || (!!w.accountId && !pre.data)} onClick={review}>
          {w.accountId ? `Review and sign ${txs.length === 1 ? "1 transaction" : `${txs.length} transactions`}` : "Connect a wallet to sign"}
        </button>
      </section>
      <Source>No signature is requested until you have read the execution page, re-checked against the chain.</Source>

      {/* Below the button on purpose: the action is what most readers came for,
          and the annex is for whoever wants to read every byte or run it
          themselves. The execution page shows the same transactions again, but
          not this command — it lives here, once. */}
      <Heading kicker="Annex">The exact transactions</Heading>
      <p className="mb-6 max-w-[64ch] text-[18px]">
        What signing will send, and the same thing as a command you can run yourself with no wallet connected.
      </p>
      {parsed.ok ? <TxPreview txs={txs} signer={w.accountId} /> : <p className="typed text-faint">Correct the defect above to see them.</p>}

      {ask && (
        <ConfirmTxDialog
          ask={ask} onClose={() => setAsk(null)}
          onSigned={(hashes, pending) => setSigned({ cb: { kind: "signed", hashes }, pending })}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------- confirmation */

/** The open, as the shared confirm dialog asks it: summary, frozen txs, a fresh chain check. */
function postAsk(signer: string, terms: MandateTerms, amount: string, txs: Tx[], table: TokenTable): Ask {
  const inTok = meta(table, terms.origin_asset);
  const outTok = meta(table, terms.destination_asset);
  const storage = txs.find((t) => t.actions[0].methodName === "storage_deposit");
  return {
    kind: "open",
    title: "Agreement to exchange",
    signer, txs,
    returnPath: "/post",
    summary: (
      <SummaryRows rows={{
        "escrowed into the vault": <b className="typed">{inTok.dp === null ? amount : units(amount, inTok.dp, 6)} {inTok.symbol}</b>,
        "in exchange for": <b>{outTok.symbol}</b>,
        "§1 worst all-in cost": <span className="typed">{terms.max_cost_bps} bps</span>,
        "§3 quotes older than": <span className="typed">{terms.max_quote_age_secs} s are refused</span>,
        "§7 expires": <span className="typed">{new Date(Number(BigInt(terms.expiry_ns) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 16)} UTC</span>,
        "storage prepaid": <span className="typed">{storage ? `${near(storage.actions[0].deposit, 5)} NEAR (withdrawable when unused)` : "none — already prepaid"}</span>,
        "§8 quote recipient": <code>{terms.recipient}</code>,
      }} />
    ),
    check: async () => blockers(await preflight(signer, terms.origin_asset), txs, amount, inTok.symbol, inTok.dp),
  };
}

/* ------------------------------------------------------------------ fields */

/** A token chosen in a blank: a native select, dressed as the agreement's handwriting. */
function TokenBlank({ value, onChange, table, invalid }: {
  value: string; onChange: (v: string) => void; table: TokenTable; invalid: boolean;
}): ReactNode {
  const ids = Object.keys(table).sort((a, b) => table[a].symbol.localeCompare(table[b].symbol));
  if (!ids.includes(value)) ids.unshift(value);
  return (
    <select
      className="blank cursor-pointer appearance-none pr-[1.1em]" value={value} aria-invalid={invalid}
      onChange={(e) => onChange(e.target.value)}
      style={{ backgroundImage: "linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%)", backgroundPosition: "right .35em center, right .1em center", backgroundSize: ".25em .25em", backgroundRepeat: "no-repeat" }}
    >
      {ids.map((id) => <option key={id} value={id}>{meta(table, id).symbol}</option>)}
    </select>
  );
}


/* ------------------------------------------------------- the market, right now */

/**
 * The ceiling is the only number in this form that cannot be guessed, and until
 * now the form let you guess it. This asks the venue for a real quote on the
 * pair and size you have typed, then asks the contract what that quote costs —
 * `worst_cost` and `realised_cost`, the two views that price bytes without
 * checking a signature, so no key and no signature are needed to read them.
 *
 * The number that matters is the FLOOR, not the expected fill. A filler on a
 * first-come-first-served book delivers the least it legally can, so a ceiling
 * below the guaranteed-worst cost is a mandate nothing can ever fill. That is
 * the one piece of advice this page can give that a reader could not work out
 * from the form.
 */
function MarketReference({ origin, dest, amount, ceiling, onUse }: {
  origin: string; dest: string; amount: string | null; ceiling: number; onUse: (bps: number) => void;
}) {
  // the form changes on every keystroke; the venue should not
  const [settled, setSettled] = useState<string | null>(amount);
  useEffect(() => {
    const t = setTimeout(() => setSettled(amount), 600);
    return () => clearTimeout(t);
  }, [amount]);

  const q = useQuery({
    queryKey: ["market", origin, dest, settled],
    enabled: !!settled && origin !== dest,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await getQuote({
        originAsset: origin, destinationAsset: dest, amount: settled!, recipient: VAULT,
      });
      const canonical = canonicalise(res);
      const [worst, full] = await Promise.all([
        view<number>("worst_cost", { canonical }),
        view<number>("realised_cost", { canonical, delivered: JSON.parse(canonical).amountOut }),
      ]);
      return { worst: Number(worst), full: Number(full) };
    },
  });

  if (!settled || origin === dest) return null;

  const body = () => {
    if (q.isPending) return <span className="text-faint">asking the venue, then the vault…</span>;
    if (q.isError) return <span className="text-faint">no live quote for this pair right now — the ceiling is still yours to set.</span>;
    const { worst, full } = q.data!;
    const unfillable = ceiling > 0 && ceiling <= worst;
    const suggestion = Math.ceil((worst * 1.25) / 25) * 25;
    return (
      <>
        <span>
          Right now this pair prices at <b className="text-sign">{full} bps</b> delivered in full, and{" "}
          <b className={unfillable ? "text-seal" : "text-sign"}>{worst} bps</b> at the floor the venue guarantees.
        </span>{" "}
        {unfillable ? (
          <span className="text-seal">
            <b>A ceiling of {ceiling} would refuse every fill</b> — a filler may legally deliver the floor, and the
            floor alone already costs {worst}.{" "}
            <button type="button" className="lnk" onClick={() => onUse(suggestion)}>use {suggestion} bps</button>
          </span>
        ) : (
          <span className="text-faint">
            Your {ceiling} bps leaves {(ceiling / Math.max(worst, 1)).toFixed(1)}× headroom over the floor. Anything
            above it is refused, whoever fills.
          </span>
        )}
      </>
    );
  };

  return (
    <p className="typed mt-3 block text-[13px] leading-relaxed">↳ {body()}</p>
  );
}
