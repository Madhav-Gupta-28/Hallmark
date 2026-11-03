/**
 * The figures of the explanatory memorandum. Drawn in ink on paper, like the
 * rest of the register; every number that comes from the chain is a live
 * view call, never a constant dressed up as one.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Seal, Stamp } from "@/components/doc";
import { Arrowheads } from "@/components/figure";
import { exhibitTerms } from "@/lib/exhibit";
import { fixtures, VAULT, view, type Fixtures } from "@/lib/hallmark";
import { parseCheck, refusalOf } from "@/lib/price";
import { cn } from "@/lib/utils";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const useFixtures = () => useQuery({ queryKey: ["fixtures"], queryFn: fixtures, staleTime: Infinity });

/* =================================================== Fig. 1 — a fill, animated */

type Lane = 0 | 1 | 2 | 3;
const LANES = [
  { x: 110, name: "OWNER", sub: "names the terms" },
  { x: 390, name: "VAULT", sub: VAULT },
  { x: 660, name: "FILLER", sub: "anyone" },
  { x: 895, name: "NEAR INTENTS", sub: "the venue" },
];
const STEPS: Array<{ from: Lane; to: Lane; label: string; dashed?: boolean; both?: boolean }> = [
  { from: 0, to: 1, label: "escrow the input, terms attached" },
  { from: 2, to: 1, label: "read the register — keyless", dashed: true },
  { from: 2, to: 3, label: "get a signed quote", both: true },
  { from: 2, to: 2, label: "source the output" },
  { from: 2, to: 1, label: "deliver the output FIRST, quote in msg" },
  { from: 1, to: 1, label: "verify the venue's signature" },
  { from: 1, to: 1, label: "price what arrived against §1" },
  { from: 1, to: 1, label: "credit both legs — or refuse" },
  { from: 1, to: 0, label: "owner withdraws the output" },
];
/** Where the money is after each step — what the contract's state says, nothing more. */
const HOLDS: Array<[string, string, string]> = [
  ["the input asset", "nothing", "its own inventory"],
  ["—", "the owner's input, in escrow", "its own inventory"],
  ["—", "the owner's input, in escrow", "its own inventory"],
  ["—", "the owner's input, in escrow", "a signed quote"],
  ["—", "the owner's input, in escrow", "the output, ready to deliver"],
  ["—", "escrow + the filler's delivery", "—"],
  ["—", "escrow + the filler's delivery (checking)", "—"],
  ["—", "escrow + the filler's delivery (checking)", "—"],
  ["—", "a credit for each side, pulled when they like", "—"],
  ["the output", "the filler's credit, until it withdraws", "—"],
];

export function FillFlow() {
  const [step, setStep] = useState(0);            // 0 = before anything; 1..9 = after that step
  const [playing, setPlaying] = useState(() => !reduced());
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => (s >= STEPS.length ? 0 : s + 1)), 1700);
    return () => clearInterval(t);
  }, [playing]);

  const top = 96, gap = 46, H = top + STEPS.length * gap + 14;
  return (
    <div className="sheet p-3 sm:p-5">
      <div className="-mx-3 overflow-x-auto px-3">
        <svg viewBox={`0 0 1000 ${H}`} className="min-w-[760px]" role="img" aria-label="A fill, step by step, across owner, vault, filler and venue">
          <Arrowheads />
          {LANES.map((l, i) => (
            <g key={l.name}>
              <rect x={l.x - 92} y={8} width={184} height={54} fill={i === 1 ? "var(--ink)" : "var(--paper)"} stroke="var(--ink)" strokeWidth={2.5} />
              <text x={l.x} y={32} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} fontSize={16} fill={i === 1 ? "var(--paper)" : "var(--ink)"}>{l.name}</text>
              <text x={l.x} y={51} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={14} fill={i === 1 ? "var(--hl)" : "var(--faint)"}>{l.sub}</text>
              <line x1={l.x} x2={l.x} y1={64} y2={H - 6} stroke="var(--ink)" strokeOpacity={0.25} strokeDasharray="4 6" />
            </g>
          ))}
          {STEPS.map((s, i) => {
            const n = i + 1, y = top + i * gap;
            const state = n < step ? "done" : n === step ? "now" : "next";
            const color = state === "now" ? "var(--sign)" : state === "done" ? "var(--ink)" : "#11111140";
            const mk = state === "now" ? "url(#ah-sign)" : state === "done" ? "url(#ah-ink)" : "url(#ah-faint)";
            const x1 = LANES[s.from].x, x2 = LANES[s.to].x;
            const self = s.from === s.to;
            return (
              <g key={n} style={{ transition: "opacity .3s" }} onClick={() => { setPlaying(false); setStep(n); }} className="cursor-pointer">
                <circle cx={22} cy={y} r={14} fill={state === "now" ? "var(--sign)" : "var(--paper)"} stroke={color} strokeWidth={2} />
                <text x={22} y={y + 5} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} fontSize={14} fill={state === "now" ? "#fff" : color}>{n}</text>
                {self ? (
                  <>
                    <path d={`M${x1 + 6},${y - 8} C${x1 + 70},${y - 26} ${x1 + 70},${y + 22} ${x1 + 8},${y + 8}`} fill="none" stroke={color} strokeWidth={state === "now" ? 3.5 : 2} markerEnd={mk} />
                    <text x={x1 + 78} y={y + 5} fontFamily="var(--font-serif)" fontSize={16} fontWeight={state === "now" ? 700 : 500} fill={color}>{s.label}</text>
                  </>
                ) : (
                  <>
                    <line x1={x1 + (x2 > x1 ? 6 : -6)} x2={x2 + (x2 > x1 ? -8 : 8)} y1={y} y2={y} stroke={color} strokeWidth={state === "now" ? 3.5 : 2}
                      strokeDasharray={s.dashed ? "7 6" : undefined} markerEnd={mk} markerStart={s.both ? mk : undefined} />
                    <text x={(x1 + x2) / 2} y={y - 9} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={16} fontWeight={state === "now" ? 700 : 500} fill={color}>{s.label}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 grid gap-px border-2 border-ink bg-ink sm:grid-cols-3">
        {(["Owner holds", "Vault holds", "Filler holds"] as const).map((k, i) => (
          <div key={k} className={cn("bg-paper p-3", i === 1 && "bg-paper-2")}>
            <div className="label text-faint">{k}</div>
            <div className="mt-1 text-[17px] font-semibold">{HOLDS[step][i]}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn btn-sm" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }}>← back</button>
        <button className="btn btn-sm btn-ink" onClick={() => setPlaying((p) => !p)}>{playing ? "pause" : "play"}</button>
        <button className="btn btn-sm" onClick={() => { setPlaying(false); setStep((s) => Math.min(STEPS.length, s + 1)); }}>next →</button>
        <span className="typed text-[14px] text-faint">{step === 0 ? "before the agreement" : `step ${step} of ${STEPS.length}`} · click any step</span>
      </div>
    </div>
  );
}

/* ========================================== Fig. 2 — the gauntlet, run live */

const GATES: Array<{ q: string; refusal: string; clause: string }> = [
  { q: "Did NEAR Intents sign exactly these bytes?", refusal: "BadSignature", clause: "§2" },
  { q: "Same pair as the agreement?", refusal: "WrongAsset", clause: "§2" },
  { q: "Does the quote pay the vault?", refusal: "WrongRecipient", clause: "§8" },
  { q: "Is the agreement still in force?", refusal: "MandateExpired", clause: "§7" },
  { q: "Is the quote before its own deadline?", refusal: "QuoteExpired", clause: "§3" },
  { q: "Was it signed recently enough?", refusal: "QuoteTooOld", clause: "§3" },
  { q: "Within the largest single fill?", refusal: "FillTooLarge", clause: "§1a" },
  { q: "At least the venue's signed floor arrived?", refusal: "UnderDelivered", clause: "§1" },
  { q: "Realised cost within the ceiling?", refusal: "CostCeilingBreached", clause: "§1" },
];
type Run = "exA-5min" | "exA-30d" | "honest-30d";
const RUNS: Array<[Run, string]> = [
  ["exA-5min", "Exhibit A · 5-minute bound"],
  ["exA-30d", "Exhibit A · 30-day bound"],
  ["honest-30d", "an honest quote · 30-day bound"],
];

export function Gauntlet() {
  const fx = useFixtures();
  const [run, setRun] = useState<Run | null>(null);
  const [tick, setTick] = useState(0);            // advances by interval only; reset where a run starts
  const start = (r: Run) => { setTick(0); setRun(r); };

  const verdict = useQuery({
    queryKey: ["vault", "gauntlet", run],
    enabled: !!run && !!fx.data,
    queryFn: () => {
      const f = run!.startsWith("exA") ? fx.data!.worst : fx.data!.honest;
      const terms = { ...exhibitTerms(f.canonical), max_quote_age_secs: run === "exA-5min" ? 300 : 30 * 86_400 };
      const q = JSON.parse(f.canonical);
      return view<string>("dry_check", { canonical: f.canonical, signature: f.signature, terms, delivered: q.amountOut });
    },
  });
  const c = verdict.data ? parseCheck(verdict.data) : null;
  const stopAt = c ? (c.allowed ? GATES.length : Math.max(0, GATES.findIndex((g) => g.refusal === c.reason))) : -1;

  // Walk the light down the gates one at a time, to where the contract stopped it.
  useEffect(() => {
    if (stopAt < 0 || reduced()) return;
    const t = setInterval(() => setTick((i) => (i > stopAt ? i : i + 1)), 260);
    return () => clearInterval(t);
  }, [stopAt, run]);
  const lit = stopAt < 0 ? 0 : reduced() ? stopAt + 1 : Math.min(tick, stopAt + 1);

  const finished = c && lit > stopAt;
  return (
    <div className="sheet p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="label">Run through it:</span>
        {RUNS.map(([k, l]) => (
          <button key={k} className={cn("btn btn-sm", run === k && "btn-ink")} onClick={() => start(k)}>{l}</button>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_auto]">
        <ol className="relative">
          {GATES.map((g, i) => {
            const passed = c && i < stopAt && i < lit;
            const stopped = c && !c.allowed && i === stopAt && lit > i;
            return (
              <li key={g.refusal} className="relative flex items-stretch">
                <div className="flex w-10 flex-col items-center">
                  <span className={cn("typed z-10 grid size-8 place-items-center border-2 border-ink text-[14px] font-bold",
                    passed ? "bg-sign text-white" : stopped ? "bg-seal text-white" : "bg-paper")}>{i + 1}</span>
                  {i < GATES.length - 1 && <span className={cn("w-[3px] flex-1", passed ? "bg-sign" : "bg-ink/25")} />}
                </div>
                <div className="flex flex-1 flex-wrap items-center justify-between gap-x-4 pb-4 pl-3">
                  <span className={cn("text-[17.5px]", stopped && "font-bold")}>{g.q}</span>
                  <span className={cn("typed text-[13px]", stopped ? "text-seal" : "text-faint")}>
                    no → <b>{g.refusal}</b> <span className="opacity-70">({g.clause})</span>
                  </span>
                </div>
              </li>
            );
          })}
          <li className="flex items-center gap-3 pl-1 pt-1">
            <span className={cn("typed grid h-8 shrink-0 place-items-center whitespace-nowrap border-2 border-ink px-3 text-[14px] font-bold",
              finished && c?.allowed ? "bg-sign text-white" : "bg-paper")}>ALL PASS</span>
            <span className="text-[17px]">→ credit both legs. Anything else is refused, and the token returns the delivery.</span>
          </li>
        </ol>
        <div className="flex min-w-[220px] flex-col items-center justify-center gap-3">
          {!run && <p className="typed max-w-[220px] text-center text-[14px] text-faint">pick a quote; {VAULT} runs it through the gates</p>}
          {run && verdict.isPending && <p className="typed text-[14px] text-faint">asking {VAULT}…</p>}
          {finished && c && (c.allowed
            ? <Seal key={run} slam ink="blue" top="honoured" big={`${c.costBps}`} bottom="bps" size={170} />
            : <Seal key={run} slam top={`stopped at gate ${stopAt + 1}`} big={refusalOf(c.reason).clause} bottom={refusalOf(c.reason).words} size={170} />)}
          {finished && <code className={cn("max-w-[260px] break-all text-center text-[11.5px]", c?.allowed ? "text-sign" : "text-seal")}>{verdict.data}</code>}
        </div>
      </div>
    </div>
  );
}

/* ================================================ Fig. 3 — the cost, drawn */

const STOPS = 10;
/** The delivered amount at stop t of STOPS, from the signed floor (0) to the full amountOut (STOPS). */
export function deliveredAt(minOut: string, out: string, t: number): string {
  const lo = BigInt(minOut), hi = BigInt(out);
  return (lo + ((hi - lo) * BigInt(t)) / BigInt(STOPS)).toString();
}

export function CostGauge() {
  const fx = useFixtures();
  const [which, setWhich] = useState<keyof Fixtures>("honest");
  const [t, setT] = useState(0);
  const f = fx.data?.[which];
  const q = useMemo(() => (f ? JSON.parse(f.canonical) : null), [f]);
  const delivered = q ? deliveredAt(q.minAmountOut, q.amountOut, t) : null;
  const cost = useQuery({
    queryKey: ["vault", "realised_cost", which, t],
    queryFn: () => view<number>("realised_cost", { canonical: f!.canonical, delivered }),
    enabled: !!f,
    placeholderData: (prev) => prev,
  });

  // Drawing only: the bar lengths. The number printed is the contract's.
  const inUsd = q ? Number(q.amountInUsd) : 1;
  const gotUsd = q ? Number(q.amountOutUsd) * (Number(delivered) / Number(q.amountOut)) : 0;
  const pct = Math.max(0, Math.min(100, (gotUsd / inUsd) * 100));
  const bps = cost.data;
  const over = (bps ?? 0) > 300;

  return (
    <div className="sheet p-4 sm:p-6">
      <p className="text-[18px] leading-[2.1]">
        The <select className="blank cursor-pointer" value={which} onChange={(e) => { setWhich(e.target.value as keyof Fixtures); setT(0); }} aria-label="capture">
          <option value="honest">honest</option><option value="worst">Exhibit A (99.99%)</option><option value="sandbox">sandbox</option>
        </select> capture, with the filler delivering{" "}
        <b className="typed text-sign">{t === 0 ? "only the signed floor" : t === STOPS ? "everything quoted" : `${t * 10}% of the way to the full quote`}</b>:
      </p>
      <input type="range" min={0} max={STOPS} value={t} onChange={(e) => setT(Number(e.target.value))} className="mt-2 w-full accent-[var(--ink)]" aria-label="delivery" />
      <div className="typed flex justify-between text-[12px] text-faint"><span>signed floor</span><span>full quote</span></div>

      <div className="mt-6 space-y-4">
        <Bar label="The owner paid" value={q ? `$${inUsd.toFixed(4)}` : "…"} pct={100} ink="ink" />
        <Bar label="The owner received" value={q ? `$${gotUsd.toFixed(4)}` : "…"} pct={pct} ink={over ? "seal" : "sign"} gap mark={97} />
        <p className="typed pl-0 text-[12.5px] text-faint sm:pl-[11rem]">│ the black mark: a 300 bps ceiling means the owner must receive at least 97% of what they paid</p>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline gap-4 border-t-2 border-ink pt-4">
        <span className="label">{VAULT} prices it at</span>
        <b className={cn("typed text-[40px] leading-none", over ? "text-seal" : "text-sign")}>{bps ?? "…"} bps</b>
        {bps !== undefined && (over ? <Stamp>over a 300 bps ceiling</Stamp> : <Stamp ink="blue">within a 300 bps ceiling</Stamp>)}
      </div>
    </div>
  );
}

function Bar({ label, value, pct, ink, gap, mark }: { label: string; value: string; pct: number; ink: "ink" | "sign" | "seal"; gap?: boolean; mark?: number }) {
  return (
    <div className="grid items-center gap-x-4 sm:grid-cols-[10rem_1fr]">
      <span className="label text-faint">{label}</span>
      <div className="relative h-10 border-2 border-ink bg-paper">
        <div className={cn("absolute inset-y-0 left-0 transition-[width] duration-300", ink === "ink" ? "bg-ink" : ink === "sign" ? "bg-sign" : "bg-seal")} style={{ width: `${pct}%` }} />
        {gap && pct < 100 && (
          <div className="absolute inset-y-0 right-0 grid place-items-center bg-[repeating-linear-gradient(135deg,transparent_0_5px,#d4161b55_5px_7px)]" style={{ width: `${100 - pct}%` }}>
            {100 - pct > 9 && <span className="typed text-[12px] font-bold text-seal">the cost</span>}
          </div>
        )}
        {mark !== undefined && <span className="absolute -bottom-2 -top-2 z-10 w-[4px] bg-ink" style={{ left: `${mark}%` }} aria-hidden />}
        <span className={cn("typed absolute inset-y-0 left-2 flex items-center text-[14px] font-bold", ink === "ink" || pct > 25 ? "text-paper" : "text-ink")}>{value}</span>
      </div>
    </div>
  );
}

/* ============================================ Fig. 4 — the hole, on a timeline */

export function HoleTimeline() {
  const ticks: Array<[number, string]> = [[60, "signed"], [170, "+5 min"], [330, "+1 day"], [500, "+30 days"], [690, "+1 year"], [900, "+10 years"]];
  return (
    <div className="sheet -mx-0 overflow-x-auto p-4 sm:p-6">
      <svg viewBox="0 0 1000 250" className="min-w-[720px]" role="img" aria-label="v1 accepted a quote until its deadline, up to ten years; v3 refuses it after the owner's bound">
        <Arrowheads />
        <line x1={40} x2={960} y1={205} y2={205} stroke="var(--ink)" strokeWidth={2.5} markerEnd="url(#ah-ink)" />
        {ticks.map(([x, l]) => (
          <g key={l}>
            <line x1={x} x2={x} y1={198} y2={212} stroke="var(--ink)" strokeWidth={2} />
            <text x={x} y={234} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={14} fontWeight={700}>{l}</text>
          </g>
        ))}
        <text x={966} y={210} fontFamily="var(--font-mono)" fontSize={12} fill="var(--faint)">time</text>

        <text x={60} y={36} fontFamily="var(--font-mono)" fontSize={13} fontWeight={700} fill="var(--seal)">v1 · ACCEPTED UNTIL THE DEADLINE — WHICH THE FILLER CHOOSES</text>
        <rect x={60} y={46} width={840} height={42} fill="#d4161b22" stroke="var(--seal)" strokeWidth={2.5} />
        <text x={480} y={73} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={18} fontStyle="italic" fill="var(--seal)">
          a free option on the owner's escrow, priced at frozen marks — 1Click signs a 10-year deadline for nothing
        </text>

        <text x={60} y={124} fontFamily="var(--font-mono)" fontSize={13} fontWeight={700} fill="var(--sign)">v3 · REFUSED ONCE OLDER THAN THE OWNER'S BOUND — FROM THE VENUE'S OWN TIMESTAMP</text>
        <rect x={60} y={134} width={110} height={42} fill="var(--sign)" stroke="var(--ink)" strokeWidth={2} />
        <text x={115} y={161} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={14} fontWeight={700} fill="#fff">300 s</text>
        <text x={186} y={161} fontFamily="var(--font-serif)" fontSize={18} fill="var(--ink)">→ after this, <tspan fontWeight={700}>QuoteTooOld</tspan>, however far away the deadline is</text>
      </svg>
    </div>
  );
}

/* ============================================ Fig. 5 — who pays for the bytes */

export function StorageBars() {
  const px = 1.15;
  const rows: Array<{ call: string; who: string; parts: Array<[string, number]> }> = [
    { call: "open", who: "the owner", parts: [["mandate record", 296], ["open-index entry", 228]] },
    { call: "fill", who: "the filler", parts: [["owner's credit slot", 145], ["filler's credit slot", 145]] },
    { call: "storage_deposit", who: "the depositor", parts: [["its own ledger row", 74]] },
    { call: "fund", who: "nobody", parts: [] },
  ];
  return (
    <div className="sheet p-4 sm:p-6">
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.call} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[11rem_9rem_1fr]">
            <code className="font-bold">{r.call}</code>
            <span className="label text-faint">{r.who} pays</span>
            <div className="flex flex-wrap items-center gap-1">
              {r.parts.length === 0 && <span className="typed text-[14px] text-faint">writes no new state — costs nothing</span>}
              {r.parts.map(([l, b], i) => (
                <span key={l} className={cn("typed flex h-9 items-center justify-center border-2 border-ink px-1 text-[11.5px] font-bold", i % 2 ? "bg-paper-2" : "bg-hl")}
                  style={{ width: `${b * px}px` }} title={`${l}: ${b} bytes`}>{b} B</span>
              ))}
              {r.parts.length > 0 && <span className="typed ml-2 text-[13px] text-faint">{r.parts.map(([l]) => l).join(" + ")}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 border-t-2 border-ink pt-4">
        <p className="label mb-3">And it round-trips — the v3 mainnet fill, the filler's prepaid bytes:</p>
        <div className="flex items-end gap-6">
          {[["after opening", 426], ["after the fill", 123], ["after both withdrawals", 426]].map(([l, b]) => (
            <div key={l as string} className="flex flex-col items-center gap-1">
              <span className="typed text-[14px] font-bold">{b}</span>
              <span className="w-16 border-2 border-ink bg-sign" style={{ height: `${(b as number) / 4}px` }} />
              <span className="typed max-w-[7rem] text-center text-[12px] text-faint">{l}</span>
            </div>
          ))}
          <p className="max-w-[360px] text-[16.5px]">303 bytes charged for the two credit slots the fill created — and both refunded the moment the payouts landed.</p>
        </div>
      </div>
    </div>
  );
}

/* ================================================= Fig. 6 — the race, on a ruler */

export function RaceRuler() {
  const racers: Array<[number, string, string]> = [[69, "adapted.ts", "the official agent"], [119, "fill.ts", "the reference"], [169, "edge.ts", "the independent one"]];
  return (
    <div className="sheet overflow-x-auto p-4 sm:p-6">
      <svg viewBox="0 0 1000 190" className="min-w-[640px]" role="img" aria-label="Three fillers at 69, 119 and 169 bps, all under a 300 bps ceiling">
        <Arrowheads />
        <rect x={50} y={110} width={900} height={18} fill="var(--paper)" stroke="var(--ink)" strokeWidth={2.5} />
        {[0, 50, 100, 150, 200, 250, 300].map((b) => {
          const x = 50 + (b / 300) * 900;
          return <g key={b}><line x1={x} x2={x} y1={128} y2={140} stroke="var(--ink)" strokeWidth={2} />
            <text x={x} y={158} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13}>{b}</text></g>;
        })}
        <line x1={950} x2={950} y1={90} y2={140} stroke="var(--seal)" strokeWidth={4} />
        <text x={950} y={82} textAnchor="end" fontFamily="var(--font-mono)" fontSize={13} fontWeight={700} fill="var(--seal)">CEILING 300 bps</text>
        {racers.map(([b, name, who], i) => {
          const x = 50 + (b / 300) * 900;
          return (
            <g key={name}>
              <line x1={x} x2={x} y1={30 + i * 22} y2={110} stroke="var(--sign)" strokeWidth={3} />
              <circle cx={x} cy={119} r={7} fill="var(--sign)" stroke="var(--ink)" strokeWidth={2} />
              <text x={x + 8} y={36 + i * 22} fontFamily="var(--font-mono)" fontSize={14} fontWeight={700} fill="var(--sign)">{b} bps · {name}</text>
              <text x={x + 8} y={36 + i * 22 + 14} fontFamily="var(--font-serif)" fontSize={13} fill="var(--faint)">{who}</text>
            </g>
          );
        })}
        <text x={50} y={182} fontFamily="var(--font-serif)" fontSize={15} fontStyle="italic" fill="var(--faint)">← cheaper for the owner · same live quote, one second old, mandate §1</text>
      </svg>
    </div>
  );
}

/* ======================================= Fig. 7 — NEAR's own agent, redlined */

export function Redline() {
  const rows: Array<[string, string, string]> = [
    ["[1]", "is told what to swap", "reads the register — get_mandates(), keyless — and takes pair, size and ceiling from the agreement"],
    ["[2]", "recipient: the agent", "recipient: the vault — inside the signature, so anything else is refused WrongRecipient"],
    ["[3]", "sends the INPUT to quote.depositAddress", "sends the OUTPUT to the vault, signed quote in msg — depositAddress is not signed, so nobody trusts it"],
    ["[4]", "submitDeposit, then pollStatus", "nothing — the fill settles inside ft_on_transfer; the receipt is the end"],
    ["[0]", "getQuote with 5 parameters (HTTP 400 on the live API)", "getQuote with the 4 fields the skill's own docs list — the official example did not run"],
  ];
  return (
    <div className="sheet p-4 sm:p-6">
      <p className="typed mb-3 text-[13px] text-faint">near/agent-skills · skill near-intents · rules/server-example.md — marked up</p>
      <ol>
        {rows.map(([n, was, now]) => (
          <li key={n} className="grid gap-x-4 border-b border-ink/25 py-3 sm:grid-cols-[3rem_1fr_1.4fr]">
            <span className="typed font-bold">{n}</span>
            <span className="struck text-[17px]">{was}</span>
            <span className="text-[17px] text-sign"><span className="mr-1 font-bold" aria-hidden>⁁</span>{now}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[16.5px]">Unchanged: the API, the quote request, slippageTolerance, the asset ids, reading amountOut / minAmountOut. <b>Same API, opposite direction of trust.</b></p>
    </div>
  );
}

/* ================================================= small typeset diagrams */

/** One path moves value: three kinds of token transfer into one method. */
export function OnePath() {
  const ins: Array<[string, string, string]> = [["origin token", "open", "a funded agreement"], ["origin token", "fund", "a bigger escrow"], ["destination token", "fill", "the delivery itself"]];
  return (
    <div className="sheet grid items-center gap-6 p-4 sm:p-6 md:grid-cols-[1fr_auto_1fr]">
      <div className="space-y-3">
        {ins.map(([tok, act]) => (
          <div key={act} className="flex items-center gap-3">
            <span className="typed w-40 border-2 border-ink bg-paper-2 px-2 py-1 text-[13px] font-bold">{tok}</span>
            <span className="typed text-[13px] text-faint">ft_transfer_call →</span>
            <code className="font-bold">{act}</code>
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center">
        <span className="typed bg-ink px-4 py-3 text-[16px] font-bold text-paper">ft_on_transfer</span>
        <span className="typed mt-1 text-[12px] text-faint">synchronous · no cross-contract call</span>
      </div>
      <div className="space-y-2 text-[16.5px]">
        <p>The token that arrived decides which action is legal, so <b>an action cannot be performed with the wrong asset</b>.</p>
        <p>No rollback path, no in-flight record, no stuck state.</p>
      </div>
    </div>
  );
}

/** The mandate struct, as the form it really is. */
export function MandateForm() {
  const fields: Array<[string, string, ReactNode]> = [
    ["origin_asset", "nep141:wrap.near", "what the owner gives"],
    ["destination_asset", "nep141:usdt.tether-token.near", "what they want"],
    ["recipient", "hallmarkfi.near", "the signed recipient every quote must name"],
    ["max_cost_bps", "300", <b key="b">the whole point</b>],
    ["max_fill", "40000000000000000000000", "largest single fill, base units"],
    ["max_quote_age_secs", "300", "how stale the USD marks may be"],
    ["expiry_ns", "1796231333050000000", "a u64 as a string, so no JS client loses precision"],
  ];
  return (
    <div className="sheet p-4 sm:p-6">
      <p className="label mb-2">pub struct Mandate — filled in with agreement §1's real terms</p>
      {fields.map(([k, v, why]) => (
        <div key={k} className="grid items-baseline gap-x-4 border-b border-ink/25 py-2 sm:grid-cols-[13rem_1fr_1fr]">
          <code className="font-bold">{k}</code>
          <span className="typed break-all border-b-2 border-ink text-[14px] font-bold text-sign">{v}</span>
          <span className="text-[16px] text-faint">{why}</span>
        </div>
      ))}
      <p className="mt-3 text-[16.5px]">Four numbers and two assets. No policy language, no allowlist. <b>A bound nobody can read is a bound nobody trusts.</b></p>
    </div>
  );
}

/** Sixteen invariants as a wall of numbered plates. */
export function InvariantWall({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="grid gap-px border-2 border-ink bg-ink sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([inv, by], i) => (
        <div key={i} className="flex flex-col justify-between gap-2 bg-paper p-3">
          <div><span className="typed mr-1 font-bold text-sign">{i + 1}.</span><span className="text-[16px] leading-snug">{inv}</span></div>
          <code className="text-[11.5px] text-faint">{by}</code>
        </div>
      ))}
    </div>
  );
}
