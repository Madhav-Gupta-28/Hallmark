/**
 * Exclusions & limitations — "the most credible page on this
 * site"), figure first. Every limit is still here in full, in the folds; what a
 * first-time reader sees is five exhibits. The wallet passage describes this
 * app (selector bundled from npm), not the static site's CDN load.
 */
import type { ReactNode } from "react";
import { L, Seal, Stamp } from "@/components/doc";
import { Arrowheads, Figure } from "@/components/figure";
import { cn } from "@/lib/utils";
import { Count } from "@/motion/Count";

export function LimitsPage() {
  return (
    <main className="doc">
      <section className="relative pt-10">
        <div className="label text-faint">Schedule D · the most credible page in this register</div>
        <h1 className="mt-3 font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
          Exclusions <span className="font-medium italic">&amp;</span> limitations.
        </h1>
        <p className="mt-5 max-w-[700px] text-[20px]">
          What Hallmark does not do, the one hole it cannot close, and every limit we know of — collected here rather
          than buried. Three exhibits; every other limit is folded under them.
        </p>
        <div className="pointer-events-none absolute -top-2 right-0 hidden xl:block">
          <Seal top="read this" big="§D" bottom="before signing" size={140} tilt={11} />
        </div>
      </section>

      <Figure no="D1" title="Four things we do not claim"
        takeaway={<>Hallmark guarantees a <span className="hl">bound</span> on your cost. It does not promise the best price, rate counterparties, or ever hold your funds.</>}
        full={<>
          <p><b>Not best execution.</b> Hallmark proves a bound and enforces a realised cost, not optimality. With one filler and first-come-first-served, the filler delivers near the floor and keeps the spread: the owner gets their ceiling, not the best price in the market. The next version is an auction, and it must not be the obvious one: collecting deliveries for N blocks would have the vault holding N fillers' tokens and returning N−1 of them — a custody window of exactly N blocks, and the twelfth design that does not survive <i>not a custodian, ever</i>. What survives is <b>bid, then deliver</b>: fillers commit a hash of the amount they will deliver, reveal it when the window closes, and only the winner ever sends a token. Nothing is returned because nothing was held. Not a v1 claim.</p>
          <p><b>Not an independent price benchmark.</b> Killed by measurement, and it was the more compelling story. All 8,992 Rhea pools were scanned: 31 contain Intents-USDC, and zero contain Intents-USDC and wNEAR together. The cause is asset fragmentation — Intents uses omni-bridge tokens while Rhea's liquidity sits in factory.bridge.near wrappers and native tokens. Same tickers, different assets. This is why the signed USD marks are the right reference: there is no on-chain alternative.</p>
          <p><b>Not a reputation or counterparty-scoring system.</b> No account-age heuristics, no blocklists, no contract-change detection. Six public NEAR repositories already do that, and all six pass the 99.99% quote.</p>
          <p><b>Not a custodian, ever.</b> The output is in the vault before the input is credited to anybody, and payouts are pull rather than push. No design that involved holding a counterparty's funds survived review — there are eleven of them in the design ledger.</p>
        </>}>
        <div className="grid gap-px border-2 border-ink bg-ink sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["Best execution", "You get your ceiling, not the best price in the market."],
            ["A price benchmark", "Measured: no on-chain pool holds the same assets. The venue's signed marks are the only reference."],
            ["Counterparty scoring", "No blocklists, no reputation. Six projects do that — and all six pass the 99.99% quote."],
            ["Custody", "The output is in before the input is credited. Nobody ever holds your funds."],
          ] as const).map(([claim, why], i) => (
            <div key={claim} className="bg-paper p-5 pb-6">
              <Stamp tilt={i % 2 ? 3 : -4} className="mb-3 text-[11px]">excluded</Stamp>
              <p className="font-serif text-[28px] font-extrabold leading-tight"><span className="struck">{claim}</span></p>
              <p className="mt-3 text-[16.5px]">{why}</p>
            </div>
          ))}
        </div>
      </Figure>

      <Figure no="D2" title="The one hole we cannot close"
        takeaway={<>Everything rests on one signing key at NEAR Intents. If it were stolen, the cryptography is gone — but your loss would <i>still</i> be capped by your own ceiling.</>}
        full={<>
          <p>An attacker could mint quotes with any terms, and Hallmark would accept any that fit the ceiling. The guarantee degrades from cryptographic to the ceiling the owner signed — which still caps the loss at <code>max_cost_bps</code> of <code>max_fill</code> per fill rather than the whole escrow, but the crypto is gone.</p>
          <p><b>This is not fixable from inside the design.</b> It is stated rather than buried.</p>
          <p>The weakest assumption the project is willing to make is the neighbouring one: that 1Click's signed <code>amountInUsd</code> and <code>amountOutUsd</code> marks are honest. The whole bound is denominated in them. If the venue marks dishonestly, the bound is wrong — but it is their own signature, which is why this is the weakest link we accept and why it is worth accepting.</p>
          <p className="mt-8 mb-2 text-[19px] font-semibold">The second open line: the upgrade key this project still holds, on purpose.</p>
          <KeyTimeline />

          <p>“Nobody to switch it off” is only true once it is executed. After the final deploy the full-access key gets deleted, so the contract cannot be upgraded or paused by anyone, including us. Two costs, both accepted and both stated: <b>a bug found later cannot be patched</b>, only superseded; and <b>the storage lock becomes permanent</b> — an account with no full-access key cannot be deleted, and deleting the account is the only way to release the NEAR staked against the contract's code, 2.76 NEAR for this contract. Immutability and recoverability are the same key; you cannot keep both.</p>
          <p><b>The key still exists, deliberately.</b> This project found a critical bug in a contract that was already live, twice — and fixed both by redeploying. Had the key been gone, neither could have been fixed. Because the cost is identical whenever it is paid, the key is deleted last, after the hackathon's winners are announced.</p>
        </>}>
        <KeyChain />
      </Figure>

      <Figure no="D3" title="Every adversary, and what happens to them"
        takeaway={<>Of eleven attacks we model, nine are impossible, closed or bounded. Two are open, and they are named.</>}
        full={<>
          <p>The threat model, in full, is the board above: each adversary, what they can do, and the outcome. Both open lines — the venue's signing key and the upgrade key this project still holds — are Exhibit D2.</p>
          <p className="mt-8 mb-2 text-[19px] font-semibold">And the ten limits that are not attacks, numbered. None of these loses the owner money:</p>
          <KnownLimits />
        </>}>
        <ThreatBoard />
      </Figure>

      <section className="mt-20">
        <h2 className="font-serif text-[clamp(26px,3.4vw,40px)] font-extrabold leading-tight">What success looks like, honestly</h2>
        <p className="mt-3 max-w-[820px] text-[clamp(20px,2.2vw,25px)] leading-snug">Not a billion-dollar company. A stranger delegating a real order — and a filler they do not know filling it inside the bound.</p>
        <div className="mt-7 grid gap-px border-2 border-ink bg-ink md:grid-cols-2">
          <div className="bg-paper p-6">
            <p className="label text-sign">The first number worth watching</p>
            <p className="mt-2 font-serif text-[26px] font-bold leading-snug">One real order, drawn up by someone else, filled by a stranger, inside the bound.</p>
          </div>
          <div className="bg-paper-2 p-6">
            <p className="label text-faint">The thesis — not a projection</p>
            <p className="mt-2 text-[18px]">If machines execute for us, something has to bound them. At 1Click's 20 bps against <b>$4.80B a month</b> of Intents volume, that is a real business long before it is a large one.</p>
          </div>
        </div>
      </section>

      <p className="mt-16 text-[19px]"><L to="/how">How the clauses are enforced →</L> · <L to="/">Back to the agreement</L></p>
    </main>
  );
}

/* ---------------------------------------------------- D2 — the key chain */

function KeyChain() {
  const nodes: Array<[number, string, string]> = [[110, "1Click's signing key", "held by the venue"], [420, "a signed quote", "signed numbers + time"], [730, "hallmarkfi.near", "verifies, then bounds"]];
  return (
    <div className="sheet overflow-x-auto p-4 sm:p-6">
      <svg viewBox="0 0 1000 300" className="min-w-[700px]" role="img" aria-label="The venue's key signs the quote; the vault verifies it; if the key is stolen the loss is still capped by the ceiling">
        <Arrowheads />
        {nodes.map(([x, t, s], i) => (
          <g key={t}>
            <rect x={x - 100} y={40} width={200} height={84} fill={i === 0 ? "#d4161b18" : i === 2 ? "var(--ink)" : "var(--paper)"} stroke={i === 0 ? "var(--seal)" : "var(--ink)"} strokeWidth={3} />
            <text x={x} y={78} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={20} fontWeight={800} fill={i === 2 ? "var(--paper)" : i === 0 ? "var(--seal)" : "var(--ink)"}>{t}</text>
            <text x={x} y={102} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fill={i === 2 ? "var(--hl)" : "var(--faint)"}>{s}</text>
          </g>
        ))}
        <line x1={212} x2={318} y1={82} y2={82} stroke="var(--ink)" strokeWidth={3} markerEnd="url(#ah-ink)" />
        <text x={265} y={70} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fontWeight={700}>signs</text>
        <line x1={522} x2={628} y1={82} y2={82} stroke="var(--ink)" strokeWidth={3} markerEnd="url(#ah-ink)" />
        <text x={575} y={70} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fontWeight={700}>checked by</text>
        <line x1={832} x2={960} y1={82} y2={82} stroke="var(--sign)" strokeWidth={3} markerEnd="url(#ah-sign)" />
        <text x={896} y={70} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fontWeight={700} fill="var(--sign)">fill</text>

        {/* the break */}
        <path d="M70,150 l20,24 l-14,6 l22,28" fill="none" stroke="var(--seal)" strokeWidth={4} />
        <text x={110} y={190} fontFamily="var(--font-mono)" fontSize={14} fontWeight={700} fill="var(--seal)">IF STOLEN →</text>
        <text x={110} y={212} fontFamily="var(--font-serif)" fontSize={18} fill="var(--seal)">an attacker can sign any quote; the crypto is gone</text>
        <rect x={560} y={160} width={400} height={110} fill="var(--paper)" stroke="var(--sign)" strokeWidth={3} />
        <text x={760} y={190} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fontWeight={700} fill="var(--sign)">WHAT STILL HOLDS</text>
        <text x={760} y={220} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={19} fontWeight={700}>loss ≤ your ceiling × your max fill</text>
        <text x={760} y={246} textAnchor="middle" fontFamily="var(--font-serif)" fontSize={17} fill="var(--faint)">per fill — never the whole escrow at once</text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------ D3 — the threat board */

type Verdict = "impossible" | "refused" | "closed" | "bounded" | "liveness only" | "unmitigated" | "open until deleted";
const THREATS: Array<[string, string, Verdict]> = [
  ["A prompt-injected agent of your own", "delivers against any quote it can get", "bounded"],
  ["A malicious filler", "any slippage, any hidden fee, any route", "refused"],
  ["A filler naming its own deposit address", "—", "impossible"],
  ["A filler claiming another's delivery", "—", "impossible"],
  ["A filler banking free signed quotes", "1Click signs a 10-year deadline for nothing", "closed"],
  ["A griefer buying the vault's storage", "~10 cents to stop every write", "closed"],
  ["A filler with a stolen agent key", "unlimited delivery attempts", "bounded"],
  ["1Click, signing a terrible quote", "—", "refused"],
  ["1Click, refusing to sign", "—", "liveness only"],
  ["1Click's signing key, stolen", "mint any signed quote", "unmitigated"],
  ["Us, the deployer", "no admin function — but the upgrade key is still held", "open until deleted"],
];

function ThreatBoard() {
  const red = (v: Verdict) => v === "unmitigated" || v === "open until deleted";
  return (
    <div className="sheet p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap gap-6">
        <span className="font-serif text-[22px]"><b className="typed text-[34px] text-sign"><Count to={9} /></b> handled</span>
        <span className="font-serif text-[22px]"><b className="typed text-[34px] text-seal"><Count to={2} /></b> open, and named</span>
      </div>
      <ol>
        {THREATS.map(([who, can, v]) => (
          <li key={who} className="grid items-center gap-x-4 gap-y-1 border-b border-ink/25 py-3 sm:grid-cols-[1.3fr_1.4fr_11rem]">
            <span className={cn("text-[17.5px] font-semibold", red(v) && "text-seal")}>{who}</span>
            <span className="text-[15.5px] text-faint">{can}</span>
            <span className="sm:text-right"><Stamp ink={red(v) ? "red" : "blue"} tilt={red(v) ? -3 : 0}>{v}</Stamp></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------ D4 — the known limits */

const LIMITS: Array<[string, string, ReactNode]> = [
  ["One sub-cent transfer is not attributed", "~0.00145 NEAR moves between filler and owner", "A fill charges the filler for the owner's credit slot, and the owner is credited ~0.00145 NEAR for releasing it. Never a loss to the vault, and it cannot be farmed, because every such transfer requires a real delivery that costs the filler far more than that."],
  ["Fillers deliver near the floor", "first come, first served", "With one filler and first-come-first-served, the owner gets their ceiling, not the best price. A sealed-bid auction where only the winner delivers is the next version — the obvious one, collecting deliveries and refunding losers, is custody. Not a v1 claim."],
  ["Signer-key theft is unmitigated", "see Exhibit D2", "If 1Click's key is stolen the cryptography is gone; the ceiling still caps each fill."],
  ["No independent price benchmark", "a bound, never best execution", "There is no on-chain pool holding the same assets; the venue's signed marks are the only reference."],
  ["Liveness depends on 1Click", "it never stops refusing", <>If the API stops signing, Hallmark stops filling — never refusing, the safe direction. <i>Observed:</i> on 2026-11-02 the API returned HTTP 521, then served <code>/v0/tokens</code> while refusing every quote. Every keyless view kept answering. It also found a gap: posting needed <code>/v0/tokens</code> to resolve a ticker. Fixed — and the live mandate was posted during the outage to prove it.</>],
  ["The filler needs capital", "it fronts the output", "This is the deliberate cost of closing the depositAddress hole, and it is what a dealer does."],
  ["Three fillers, all ours", "no third-party ecosystem yet", "All written by us or adapted by us, and none other is claimed."],
  ["Immutable means unpatchable", "once the key is gone", "After the full-access key is deleted, a bug can only be superseded by a new deployment that owners migrate to voluntarily."],
  ["Mainnet only", "there is no Intents testnet", "Dev accounts, tiny amounts, dry:true quotes wherever possible."],
  ["Signing needs a wallet library", "third-party code — bundled, and optional", <>Reading needs nothing. But a NEAR function-call key can only sign zero-deposit calls to one contract, and drawing up an agreement needs a deposit on the vault and one yoctoNEAR on the token — so signing needs a full-access signature from a wallet. This app bundles <code>@near-wallet-selector</code> 8.10.2 from npm, pinned exactly, and loads it only when you connect. Every execution page renders the exact transaction and <code>near</code> command from the same objects the wallet is handed, so everything stays possible with no wallet at all. A rival connector was rejected outright because its wallet manifest resolved to one individual's personal GitHub repository.</>],
];

function KnownLimits() {
  return (
    <div className="grid gap-px border-2 border-ink bg-ink md:grid-cols-2">
      {LIMITS.map(([t, s, full], i) => (
        <details key={t} className="group bg-paper open:bg-paper-2">
          <summary className="flex cursor-pointer list-none items-start gap-4 p-4 hover:bg-hl [&::-webkit-details-marker]:hidden">
            <span className="typed grid size-9 shrink-0 place-items-center border-2 border-ink text-[15px] font-bold">{i + 1}</span>
            <span className="flex-1">
              <span className="block font-serif text-[20px] font-bold leading-tight">{t}</span>
              <span className="typed mt-1 block text-[13px] text-faint">{s}</span>
            </span>
            <span className="typed text-[16px] transition-transform group-open:rotate-90" aria-hidden>▸</span>
          </summary>
          <div className="px-4 pb-4 pl-[4.25rem] text-[16.5px] leading-[1.5]">{full}</div>
        </details>
      ))}
    </div>
  );
}

/* --------------------------------------------- D5 — the upgrade key's life */

function KeyTimeline() {
  const events: Array<[string, string, "ink" | "seal" | "sign" | "now" | "future"]> = [
    ["v1 deployed", "live on mainnet", "ink"],
    ["audit: the stale-quote hole", "a free option on every escrow", "seal"],
    ["v2 deployed", "fixed by redeploying — the key", "sign"],
    ["audit: the storage hole", "strangers' state on the vault", "seal"],
    ["v3 deployed", "fixed by redeploying — the key", "sign"],
    ["today", "the key is still held", "now"],
    ["winners announced", "", "future"],
    ["key deleted", "irreversible", "future"],
  ];
  return (
    <div className="sheet p-4 sm:p-6">
      <ol className="relative grid gap-y-6 md:grid-cols-8 md:gap-x-2">
        <span className="absolute left-[15px] top-2 bottom-2 w-[3px] bg-ink md:left-2 md:right-2 md:top-[15px] md:bottom-auto md:h-[3px] md:w-auto" aria-hidden />
        {events.map(([t, s, k]) => (
          <li key={t} className="relative flex items-start gap-3 md:flex-col md:items-start md:gap-2">
            <span className={cn("z-10 grid size-8 shrink-0 place-items-center border-[3px]",
              k === "seal" ? "border-seal bg-seal" : k === "sign" ? "border-ink bg-sign" : k === "now" ? "border-ink bg-hl" : k === "future" ? "border-dashed border-ink bg-paper" : "border-ink bg-ink")} />
            <span>
              <span className={cn("block text-[16.5px] font-bold leading-tight", k === "seal" && "text-seal", k === "future" && "text-faint")}>
                {k === "now" ? <span className="hl">{t}</span> : t}
              </span>
              {s && <span className="typed mt-1 block text-[12.5px] text-faint">{s}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-8 grid gap-px border-2 border-ink bg-ink sm:grid-cols-2">
        <div className="bg-paper p-4"><p className="label text-seal">After deletion, forever</p><p className="mt-1 text-[17px]">A bug found later <b>cannot be patched</b> — only superseded by a new deployment owners move to.</p></div>
        <div className="bg-paper p-4"><p className="label text-seal">And the deposit is locked</p><p className="mt-1 text-[17px]"><b>2.76 NEAR</b> staked against the contract's code can never be released. Immutability and recoverability are the same key.</p></div>
      </div>
    </div>
  );
}

