import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ConfirmTxDialog, SummaryRows, type Ask } from "@/components/ConfirmTxDialog";
import { A, Clause, Entry, Heading, L, Seal, Source, Stamp } from "@/components/doc";
import { Amount, Sym } from "@/components/fields";
import { SigningResult } from "@/components/SigningResult";
import { useSigned } from "@/lib/signed";
import {
  age, EXPLORER, fixtures, short, units, VAULT, type MandateRecord, type MandateTerms,
} from "@/lib/hallmark";
import {
  captureTerms, liveQuote, parseCheck, priceQuote, refusalOf, type ParsedCheck, type Verdict,
} from "@/lib/price";
import { fillBlockers, fillTxs } from "@/lib/fill";
import { GAS_HEADROOM, preflight } from "@/lib/post";
import { mandateQuery, tokensQuery } from "@/lib/queries";
import { bothListed, meta, type TokenMeta, type TokenTable } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useWallet } from "@/wallet/context";

const NS_PER_DAY = 86_400_000_000_000n;

export function MandatePage() {
  const raw = useParams().id ?? "";
  const valid = /^\d+$/.test(raw);
  const id = valid ? Number(raw) : -1;
  const mandate = useQuery({ ...mandateQuery(id), enabled: valid });
  const tokens = useQuery(tokensQuery);
  const table = tokens.data ?? {};

  return (
    <main className="doc">
      <p className="label pt-8"><L to="/book">← the register</L></p>
      {!valid && <Refusal title={`"${raw}" is not an agreement number`}>Agreements are numbered from 1.</Refusal>}
      {valid && mandate.isPending && <p className="typed mt-10 text-faint">asking {VAULT} for agreement §{id}…</p>}
      {mandate.isError && <Refusal title="The agreement could not be read">{mandate.error.message}</Refusal>}
      {mandate.isSuccess && mandate.data === null && (
        <Refusal title={`No agreement §${id}`}>
          The vault holds no record under this number. Either it was never drawn up, or its owner cancelled it and
          then reaped the record to recover its storage. Numbers are never reused.
        </Refusal>
      )}
      {mandate.isSuccess && mandate.data && (
        <>
          <Agreement id={id} m={mandate.data} table={table} readAt={mandate.dataUpdatedAt} />
          <Compliance id={id} m={mandate.data} table={table} />
        </>
      )}
    </main>
  );
}

function Refusal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-8 py-14 sm:flex-row sm:items-center">
      <Seal slam top="refused" big="§?" bottom="not found" size={160} />
      <div>
        <h1 className="font-serif text-[clamp(30px,5vw,56px)] font-extrabold leading-none">{title}</h1>
        <p className="mt-4 max-w-[620px] text-[19px]">{children}</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ the agreement */

function Agreement({ id, m, table, readAt }: { id: number; m: MandateRecord; table: TokenTable; readAt: number }) {
  const t = m.terms;
  const inTok = meta(table, t.origin_asset);
  const outTok = meta(table, t.destination_asset);
  const left = (BigInt(t.expiry_ns) - BigInt(readAt) * 1_000_000n) / NS_PER_DAY;
  const expires = new Date(Number(BigInt(t.expiry_ns) / 1_000_000n));
  const pct = t.max_cost_bps ? Math.min(100, (m.worst_bps / t.max_cost_bps) * 100) : 0;
  const v = (x: ReactNode) => <b className="typed text-sign">{x}</b>;

  return (
    <section className="relative">
      <div className="label mt-6 text-faint">Agreement §{id} · {m.open ? (left > 0n ? "in force" : "expired") : "closed"}</div>
      <h1 className="mt-3 font-serif text-[clamp(40px,7.4vw,96px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
        <Sym table={table} asset={t.origin_asset} /> <span className="font-medium italic">for</span> <Sym table={table} asset={t.destination_asset} />.
      </h1>
      <div className="pointer-events-none absolute right-0 top-2 hidden md:block">
        {m.open
          ? <Seal ink="blue" top="in force" big={`§${id}`} bottom={`${t.max_cost_bps} bps ceiling`} size={150} tilt={9} />
          : <Seal top="closed" big={`§${id}`} bottom="no further fills" size={150} tilt={9} />}
      </div>

      <div className="mt-8 grid gap-x-12 md:grid-cols-2">
        <Entry k="Owner" v={<L to={`/account/${m.owner}`} className="typed">{short(m.owner, 12)}</L>} />
        <Entry k="Enforced by" v={<A href={`${EXPLORER}/address/${VAULT}`}>{VAULT}</A>} />
      </div>

      <Heading kicker="The terms, as written on chain">Clauses</Heading>
      <Clause no="§1" title="Ceiling">
        The owner will pay no more than {v(`${t.max_cost_bps} bps`)} all-in on any fill, measured on what actually arrives.
      </Clause>
      <Clause no="§1a" title="Size">
        No single fill may take more than {v(<Amount v={t.max_fill} tok={inTok} />)} of the escrow.
      </Clause>
      <Clause no="§3" title="Freshness">
        No quote signed more than {v(`${t.max_quote_age_secs} s`)} ({age(t.max_quote_age_secs)}) before the fill is honoured.
      </Clause>
      <Clause no="§7" title="Term">
        In force until {v(expires.toISOString().replace("T", " ").slice(0, 16) + " UTC")}
        {m.open && (left > 0n ? <> — {left} days from now.</> : <> — <Stamp>expired</Stamp></>)}
      </Clause>
      <Clause no="§8" title="Recipient">
        Every quote must name {v(t.recipient)} as its recipient, or the delivery cannot be verified.
      </Clause>

      <Heading kicker="Schedule A">Performance to date</Heading>
      <div className="grid gap-x-12 md:grid-cols-2">
        <div>
          <Entry k="Escrow remaining" v={<span className="typed text-[20px]"><Amount v={m.escrow} tok={inTok} /></span>} />
          <Entry k="Delivered to the owner" v={<span className="typed text-[20px]"><Amount v={m.delivered} tok={outTok} /></span>} />
          <Entry k="Fills" v={<span className="typed text-[20px]">{m.fills}</span>} />
        </div>
        <div>
          <Entry k="Worst fill ever taken" v={m.fills ? <b className="typed text-[20px] text-sign">{m.worst_bps} bps</b> : <span className="text-faint">none yet</span>} />
          {m.fills > 0 && (
            <div className="py-3">
              <Ruler marks={[{ at: pct, label: `${m.worst_bps} taken`, ink: "blue" }]} />
              <p className="typed mt-1 text-[12.5px] text-faint">Can never exceed the ceiling: the contract refuses any fill that would.</p>
            </div>
          )}
        </div>
      </div>
      <Source>get_mandate({id}) on {VAULT}, read {new Date(readAt).toLocaleTimeString()}, re-read every 30 s.</Source>
    </section>
  );
}

/** A ruler from 0 to the ceiling, with marks. Marks past the ceiling pin to its end, in red. */
function Ruler({ marks }: { marks: Array<{ at: number; label: string; ink: "blue" | "red" }> }) {
  // Marks closer than ~12% (or both pinned past the ceiling) would print over
  // each other, so each label climbs one line above the one before it.
  const placed = [...marks].sort((a, b) => a.at - b.at).map((mk, i, all) => {
    const at = Math.min(100, mk.at);
    let lift = 0;
    for (let j = 0; j < i; j++) if (Math.abs(Math.min(100, all[j].at) - at) < 12) lift++;
    return { ...mk, at, lift };
  });
  const top = Math.max(0, ...placed.map((p) => p.lift));
  return (
    <div className="relative mb-7 h-4 border-2 border-ink" style={{ marginTop: `${28 + top * 18}px` }}>
      {[25, 50, 75].map((x) => <span key={x} className="absolute -bottom-0.5 h-2 w-px bg-ink" style={{ left: `${x}%` }} />)}
      <span className="label absolute -right-1 top-5 text-[11px]">ceiling</span>
      <span className="label absolute -left-1 top-5 text-[11px]">0</span>
      {placed.map((mk) => (
        <span key={mk.label} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${mk.at}%`, transform: "translateX(-50%)" }}>
          <span className={cn("typed whitespace-nowrap text-[12px] font-bold", mk.ink === "red" ? "text-seal" : "text-sign")}
            style={{ marginBottom: `${mk.lift * 18}px` }}>{mk.label}</span>
          <span className={cn("block h-7 w-[3px]", mk.ink === "red" ? "bg-seal" : "bg-sign")} />
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------- the test of compliance */

type From = "live" | "capture";
interface Priced { source: From; terms: MandateTerms; useLive: boolean; note?: string; verdict: Verdict }

function Compliance({ id, m, table }: { id: number; m: MandateRecord; table: TokenTable }) {
  const price = useMutation({
    mutationKey: ["price", id],
    mutationFn: async (source: From): Promise<Priced> => {
      if (source === "live") {
        const { canonical, signature } = await liveQuote(m);
        return { source, terms: m.terms, useLive: true, verdict: await priceQuote(canonical, signature, m.terms) };
      }
      const f = (await fixtures()).worst;
      const { terms, useLive } = captureTerms(f.canonical, m);
      return { source, terms, useLive, note: f.note, verdict: await priceQuote(f.canonical, f.signature, terms) };
    },
  });
  const busy = price.isPending;

  return (
    <section>
      <Heading kicker="Part II">Test of compliance</Heading>
      <p className="max-w-[760px] text-[19px]">
        Would a fill be honoured right now? Fetch a real signed quote for this pair and size, and the contract
        rules on it at both delivery sizes. Nothing is signed and nothing is sent.
      </p>
      {!m.open && (
        <p className="mt-4 max-w-[760px] text-[19px]">
          <Stamp>closed</Stamp> The contract refuses every fill against a closed agreement before reading anything
          else, so there is no live fill to test. Exhibit A still shows how it rules.
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-4">
        {m.open && (
          <button className="btn btn-ink" onClick={() => price.mutate("live")} disabled={busy}>
            {busy && price.variables === "live" ? "asking the venue, then the vault…" : "Obtain a live quote"}
          </button>
        )}
        <button className="btn" onClick={() => price.mutate("capture")} disabled={busy}>
          {busy && price.variables === "capture" ? "replaying…" : "Use Exhibit A instead"}
        </button>
      </div>
      <p className="typed mt-3 text-[13px] text-faint">
        ↳ Exhibit A needs nothing from the venue: a genuinely signed capture with a hidden 500 bps fee, so you can
        see a refusal even when 1Click is down.
      </p>

      {price.isError && (
        <div className="mt-8 flex items-center gap-6">
          <Stamp>no finding</Stamp>
          <p className="text-[18px]">{price.error.message}. Nothing was signed and nothing moved.</p>
        </div>
      )}
      {price.isSuccess && <Findings p={price.data} id={id} table={table} at={price.submittedAt} open={m.open} />}
    </section>
  );
}

function Findings({ p, id, table, at, open }: { p: Priced; id: number; table: TokenTable; at: number; open: boolean }) {
  const r = p.verdict;
  const t = p.terms;
  const inTok = meta(table, t.origin_asset);
  const outTok = meta(table, t.destination_asset);
  const floor = parseCheck(r.atFloor);
  const full = parseCheck(r.atFull);
  const stale = r.ageSecs > t.max_quote_age_secs;
  const scale = (bps: number) => (t.max_cost_bps ? (bps / t.max_cost_bps) * 100 : 100);
  const reason = full.reason ?? floor.reason;

  return (
    <div className="mt-10">
      {p.source === "capture" && (
        <div className="mb-6 max-w-[820px] border-l-4 border-seal pl-5 text-[18px]">
          <p><b>Exhibit A.</b> {p.note} It is genuinely signed by NEAR Intents. Its 500 bps fee sits in{" "}
            <code>appFees</code>, which the venue does not sign and the contract never reads — it does not need to,
            because the cost is already inside the signed numbers.</p>
          <p className="mt-2">
            {p.useLive
              ? <>Tested against agreement §{id}'s real terms.</>
              : <>Agreement §{id} exchanges a different pair, so this is tested against illustrative terms for the
                capture's own pair: a {t.max_cost_bps} bps ceiling and a {t.max_quote_age_secs} s freshness bound.</>}
            {reason === "QuoteTooOld" && <> The capture was signed {age(r.ageSecs)} ago, so it is refused under{" "}
              <b>§3 (freshness)</b> before cost is even read; the costs below show it breaches §1 too.</>}
            {reason === "QuoteExpired" && <> Its own signed deadline ({r.q.deadline}) has passed, which the
              contract checks first; the costs below still show the fee.</>}
          </p>
        </div>
      )}

      <div className="grid gap-12 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <p className="label mb-2">Findings</p>
          <Entry k="Signed by NEAR Intents?" v={r.signed ? <Stamp ink="blue">yes — these exact bytes</Stamp> : <Stamp>no</Stamp>} />
          <Entry k="Unsigned field in the signed bytes?" v={r.leaked.length ? <Stamp>{r.leaked.join(", ")}</Stamp> : <span className="text-sign">none</span>} />
          <Entry k="In" v={<span className="typed">${Number(r.q.amountInUsd).toFixed(4)} · <Amount v={r.q.amountIn} tok={inTok} /></span>} />
          <Entry k="Out, if honoured in full" v={<span className="typed">${Number(r.q.amountOutUsd).toFixed(4)} · <Amount v={r.q.amountOut} tok={outTok} /></span>} />
          <Entry k="Out, guaranteed floor" v={<span className="typed"><Amount v={r.q.minAmountOut} tok={outTok} /></span>} />
          <Entry k="Signed (by the venue)" v={<span className="typed">{r.q.timestamp} · <span className={stale ? "text-seal" : "text-sign"}>{age(r.ageSecs)} ago</span></span>} />
          <Entry k="Deadline (chosen by the asker)" v={<span className="typed text-faint">{r.q.deadline}</span>} />
          <Entry k="Size against §1a" v={r.fillable ? <span className="text-sign">within {cap(t.max_fill, inTok)}</span> : <Stamp>over {cap(t.max_fill, inTok)}</Stamp>} />
          <Entry k="Cost if honoured in full" v={<b className={cn("typed text-[22px]", r.fullBps > t.max_cost_bps ? "text-seal" : "text-sign")}>{r.fullBps} bps</b>} />
          <Entry k="Guaranteed-worst cost" v={<b className={cn("typed text-[22px]", r.worstBps > t.max_cost_bps ? "text-seal" : "text-sign")}>{r.worstBps} bps</b>} />
          <div className="pb-2 pt-4">
            <Ruler marks={[
              { at: scale(r.fullBps), label: `${r.fullBps} full`, ink: r.fullBps > t.max_cost_bps ? "red" : "blue" },
              { at: scale(r.worstBps), label: `${r.worstBps} floor${r.worstBps > t.max_cost_bps ? " ▸" : ""}`, ink: r.worstBps > t.max_cost_bps ? "red" : "blue" },
            ]} />
          </div>
        </div>

        <div>
          <p className="label mb-2">Rulings</p>
          {/* Both deliveries, because a filler that sends only minAmountOut is refused whenever the
              floor alone breaches the ceiling, even though a full delivery would pass. */}
          <Ruling title="Delivering the signed floor" sub="minAmountOut — the least the venue guaranteed"
            delivered={<Amount v={r.q.minAmountOut} tok={outTok} />} raw={r.atFloor} c={floor} inTok={inTok} />
          <Ruling title="Delivering the full quote" sub="amountOut — the expected fill"
            delivered={<Amount v={r.q.amountOut} tok={outTok} />} raw={r.atFull} c={full} inTok={inTok} />
          {full.allowed && !floor.allowed && (
            <p className="mt-4 text-[17px]"><span className="hl">A filler must deliver more than the floor here.</span>{" "}
              The contract rules on what arrives: the full quote is honoured, the bare floor would be refused and
              returned.</p>
          )}
          {!full.allowed && (
            <p className="mt-4 text-[17px]">No delivery against this quote is honoured — no filler can use it on these terms.</p>
          )}
        </div>
      </div>
      {p.source === "live" && open && (full.allowed || floor.allowed) && (
        <FillAction id={id} p={p} table={table} floor={floor} full={full} />
      )}
      <Source>
        is_signed · worst_cost · realised_cost · quote_age_secs · dry_check ×2 on {VAULT}, at{" "}
        {new Date(at).toLocaleTimeString()}. Pricing signs nothing and sends nothing.
      </Source>
    </div>
  );
}

function Ruling({ title, sub, delivered, raw, c, inTok }: {
  title: string; sub: string; delivered: ReactNode; raw: string; c: ParsedCheck; inTok: TokenMeta;
}) {
  const why = refusalOf(c.reason);
  return (
    <div className="flex items-center gap-5 border-b border-ink/25 py-5">
      {c.allowed
        ? <Seal slam ink="blue" top="honoured" big={`${c.costBps}`} bottom="bps realised" size={132} tilt={-8} />
        : <Seal slam top="refused" big={why.clause} bottom={why.words} size={132} tilt={-8} />}
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        <p className="typed text-[13px] text-faint">{sub}: {delivered}</p>
        {c.allowed && c.earns && <p className="mt-1 text-[16px]">The filler would earn <Amount v={c.earns} tok={inTok} />.</p>}
        <code className={cn("mt-1 block break-all text-[12px]", c.allowed ? "text-sign" : "text-seal")} title="dry_check, verbatim">{raw}</code>
      </div>
    </div>
  );
}

const cap = (v: string, tok: TokenMeta) => (tok.dp === null ? `${v} base units` : `${units(v, tok.dp, 6)} ${tok.symbol}`);


/* ------------------------------------------------------------------ the fill */

/**
 * Filling, offered only where the chain has just said it would be honoured:
 * a live quote, priced against this agreement's own terms, on an open
 * agreement. A capture priced against illustrative terms is a demonstration,
 * not an offer, so no button appears under it.
 *
 * The full quote comes first. Both are legal deliveries and the floor earns
 * the filler more, but the floor is also the one the contract refuses whenever
 * it alone breaches the ceiling — so it is offered only when `dry_check` has
 * already allowed it, and labelled with what it costs the owner.
 */
function FillAction({ id, p, table, floor, full }: {
  id: number; p: Priced; table: TokenTable; floor: ParsedCheck; full: ParsedCheck;
}) {
  const w = useWallet();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [signed, setSigned] = useSigned();
  const r = p.verdict;
  const outTok = meta(table, p.terms.destination_asset);
  const inTok = meta(table, p.terms.origin_asset);

  const options = [
    full.allowed && { key: "full", label: "Deliver the full quote", amount: r.q.amountOut, c: full, sub: "amountOut — the expected fill" },
    floor.allowed && { key: "floor", label: "Deliver the signed floor", amount: r.q.minAmountOut, c: floor, sub: "minAmountOut — the least the venue guaranteed" },
  ].filter((o): o is { key: string; label: string; amount: string; c: ParsedCheck; sub: string } => !!o);

  async function review(o: (typeof options)[number]) {
    if (!w.accountId) return void w.openPicker();
    const signer = w.accountId;
    const pre = await preflight(signer, p.terms.destination_asset);
    const txs = fillTxs(p.terms, id, r.canonical, r.signature, o.amount, pre.prepaid, pre.estimate);
    setAsk({
      kind: "fill",
      title: `Fill agreement §${id}`,
      signer,
      txs,
      summary: (
        <SummaryRows rows={{
          "You deliver": <span className="typed"><Amount v={o.amount} tok={outTok} /></span>,
          "You are credited": <span className="typed">{o.c.earns ? <Amount v={o.c.earns} tok={inTok} /> : "—"}</span>,
          "Realised cost to the owner": <span className="typed">{o.c.costBps} bps, against a {p.terms.max_cost_bps} bps ceiling</span>,
          "If the quote goes stale first": <span>the contract refuses and the {outTok.symbol} comes straight back</span>,
        }} />
      ),
      check: async () => {
        const now = await preflight(signer, p.terms.destination_asset);
        return fillBlockers({ ...now }, o.amount, outTok.symbol, GAS_HEADROOM);
      },
      returnPath: `/mandate/${id}`,
    });
  }

  return (
    <div className="mt-10 border-t-2 border-ink pt-6">
      {signed && <SigningResult signed={signed} />}
      <p className="label mb-2">Fill it</p>
      <p className="max-w-[760px] text-[18px]">
        The chain has just ruled on both deliveries. Filling sends the {outTok.symbol} to the vault — the transfer
        <i> is</i> the delivery — with the venue's signed quote attached. If anything has changed by the time it
        lands, the contract refuses it and the token returns the delivery in full.
      </p>
      {/* The filler delivers real value first and is paid in the origin asset,
          so an origin asset the venue does not list is this page's one genuine
          hazard — and the contract cannot help, because a mandate denominated
          in a token its owner wrote is a legitimate mandate. Say so here,
          where the decision is made, rather than refusing it for them. */}
      {!bothListed(table, p.terms.origin_asset) && (
        <p className="mt-5 max-w-[760px] border-l-4 border-seal pl-5 text-[17px]">
          <b>You would be paid in an asset 1Click does not list.</b> This agreement pays fillers in{" "}
          <code>{p.terms.origin_asset}</code>, which is not in the venue's token list, so its symbol and decimals
          here are guessed from the account name. Anyone may open a mandate denominated in a token they wrote
          themselves — the contract is right not to judge that, and the escrow really is backed by a real transfer
          of it. Satisfy yourself that the token is worth what you are about to deliver.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-4">
        {options.map((o, i) => (
          <button key={o.key} className={cn("btn", i === 0 ? "btn-sign" : undefined)} onClick={() => void review(o)}>
            {o.label}
            <span className="typed ml-2 text-[12px] opacity-70">{o.c.costBps} bps</span>
          </button>
        ))}
      </div>
      <p className="typed mt-3 text-[13px] text-faint">
        ↳ The cost on each button is what the owner pays, not what you earn — the cheaper one for them is the
        dearer one for you. A fill also writes two credit slots, which the filler pays for (§6); a
        <code> storage_deposit</code> joins the batch only if yours is short.
        {!w.accountId && " Choosing one connects a wallet first; nothing is signed until you have read the batch."}
      </p>
      {ask && (
        <ConfirmTxDialog
          ask={ask} onClose={() => setAsk(null)}
          onSigned={(hashes, pending) => setSigned({ cb: { kind: "signed", hashes }, pending })}
        />
      )}
    </div>
  );
}
