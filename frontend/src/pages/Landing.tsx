/**
 * The landing page answers three questions in order, and nothing else: what
 * can I do here, what stops it going wrong, and is any of this real.
 *
 * It used to open with recitals and six paragraphs of clauses. Nobody reads a
 * wall of text on a landing page, so each term is now one line, and the only
 * long thing left is the exhibit — because the exhibit is the proof, and the
 * proof is read from the live contract while you watch.
 */
import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { A, Clause, Entry, Heading, L, Seal, Source, Stamp } from "@/components/doc";
import { exhibitA } from "@/lib/exhibit";
import { useInView } from "@/motion/inView";
import { EXPLORER, near, SIGNER, short, VAULT, view, viewAccount } from "@/lib/hallmark";
import { parseCheck, refusalOf } from "@/lib/price";
import { openCountQuery } from "@/lib/queries";
import { Count } from "@/motion/Count";
import { Grow } from "@/motion/Grow";
import { Typewriter } from "@/motion/Typewriter";

export function Landing() {
  return (
    <main className="doc">
      <Title />
      {/* The artifact first, then why every other design misses it, and only
          then the mechanism. A judge who reads three sections should have seen
          the evidence and the disagreement, not the clause list. */}
      <ExhibitA />
      <WrongVariable />
      <Terms />
      <Invariant />
      <WhyNow />
      <ScheduleB />
      <Execute />
    </main>
  );
}

/* --------------------------------------------------------------- the title */

function Title() {
  return (
    <section className="pb-6 pt-10 sm:pt-14">
      <div className="label text-faint">
        <Typewriter text="Agreement no. 1 · live on NEAR mainnet" />
      </div>
      {/* broken by hand: the highlighted phrase must never split across lines */}
      <h1 className="mt-5 font-serif font-extrabold leading-[0.97] tracking-[-0.025em] text-[clamp(30px,4.9vw,62px)]">
        <span className="block">A not-held order that</span>
        <span className="block">enforces its own</span>
        <span className="block"><span className="hl">execution bound</span>.</span>
      </h1>
      <p className="mt-7 max-w-[56ch] text-[21px] leading-[1.45]">
        Hand the trade to anyone. Name the worst all-in cost you will accept — and the contract
        refuses any fill that goes over it, measured on what actually arrived, against{" "}
        <b>NEAR Intents' own signature</b>.
      </p>
      <div className="mt-8 flex flex-wrap gap-4">
        <Link to="/post" className="btn btn-ink nudge">Draw up an agreement</Link>
        <Link to="/book" className="btn">See what is open</Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- terms */

function Terms() {
  return (
    <section>
      <Heading kicker="Part II">The terms</Heading>
      <Clause no="§1" title="The ceiling">
        You name the worst all-in cost you will pay, and it is measured on what actually arrived.
      </Clause>
      <Clause no="§2" title="The proof">
        The filler hands over the goods first. Only then can the contract pay them.
      </Clause>
      <Clause no="§3" title="Freshness">
        A quote older than your limit is refused — timed from when the venue signed it, not from any date the filler picked.
      </Clause>
      <Clause no="§4" title="Remedy">
        A fill that breaks a term is refused in the same transaction, and the tokens go straight back.
      </Clause>
      <Clause no="§5" title="Settlement">
        Nobody is paid automatically. Each side withdraws when they like, and neither can block the other.
      </Clause>
      <Clause no="§6" title="Storage">
        Whoever writes a byte pays for that byte. Close an agreement and you get it back.
      </Clause>
    </section>
  );
}

/* ------------------------------------------------------------ invariant */

function Invariant() {
  return (
    <section>
      <Heading kicker="Part III">The one invariant</Heading>
      <div className="sheet my-6 overflow-x-auto px-6 py-5">
        <code className="typed whitespace-nowrap text-[clamp(15px,2vw,22px)] font-bold">
          cost = 1 − (amountOutUsd × delivered ÷ amountOut) ÷ amountInUsd
        </code>
      </div>
      <p className="max-w-[60ch] text-[19px]">
        Four numbers the venue signed, and the amount that turned up. Every fee is already inside them,
        so there is nothing a filler can hide.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------ exhibit A */

function ExhibitA() {
  // Six view calls, and the section is below the fold — see motion/inView.
  const [ref, shown] = useInView<HTMLElement>();
  const ex = useQuery({ queryKey: ["vault", "exhibit-a"], queryFn: exhibitA, staleTime: 60_000, enabled: shown });
  const r = ex.data;
  const floor = r ? parseCheck(r.atFloor) : null;

  return (
    <section id="exhibit-a" ref={ref}>
      <Heading kicker="Exhibit A">A quote the venue really signed, and the contract refused</Heading>
      <div className="grid gap-10 lg:grid-cols-[1fr_auto]">
        <div className="max-w-[62ch] text-[19px]">
          <p>Real quote. 31 October 2026. The venue signed both of these numbers.</p>

          {/* The whole thesis as one picture: at this scale the guaranteed
              amount is a tenth of a pixel wide, so the bar says what the
              sentence cannot. */}
          <div className="sheet mt-6 px-6 py-6">
            <div className="label text-faint">What $10 was offered</div>
            <div className="mt-2 h-7 w-full border-2 border-ink">
              <Grow pct={100} className="bg-ink" />
            </div>
            <div className="typed mt-1.5 text-[17px] font-bold">2.1437 wNEAR</div>

            <div className="label mt-6 text-faint">What $10 was <i>guaranteed</i></div>
            <div className="relative mt-2 h-7 w-full border-2 border-ink">
              <Grow pct={0.01} minPx={3} className="bg-seal" />
              <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[13px] text-seal">◀</span>
            </div>
            <div className="typed mt-1.5 text-[17px] font-bold text-seal">0.00021437 wNEAR</div>
            <p className="mt-5 text-[16.5px]">
              Same bar. <b>One ten-thousandth</b> of it — too thin to draw. Read the first number and you lose
              everything but that sliver.
            </p>
          </div>
          {ex.isPending && <p className="typed mt-6 text-[15px] text-faint">asking {VAULT}…</p>}
          {ex.isError && <p className="typed mt-6 text-[15px] text-seal">{ex.error.message}</p>}
          {r && (
            <div className="mt-6">
              <Entry k="Did NEAR Intents sign these exact bytes?" v={r.signed ? <Stamp ink="blue">yes</Stamp> : <Stamp>no</Stamp>} />
              <Entry k="Worst cost it guarantees" v={<b className="typed text-[22px] text-seal"><Count to={r.worstBps} /> bps</b>} />
              <Entry k="Cost even if honoured in full" v={<b className="typed text-[22px] text-seal"><Count to={r.fullBps} /> bps</b>} />
              <Entry k="The owner's ceiling" v={<span className="typed text-[22px]">300 bps</span>} />
              <Entry k="dry_check, verbatim" v={<code className="text-[13px] text-seal">{r.atFloor}</code>} />
              <Source>
                is_signed · worst_cost · realised_cost · dry_check on {VAULT}, just now. Age bound set to the
                contract's 30-day maximum so the ceiling is what is tested.{" "}
                <L to="/verify">Try it on any quote →</L>
              </Source>
            </div>
          )}
        </div>
        <div className="flex items-start justify-center pt-4 lg:pt-10">
          {r && floor && !floor.allowed && (
            <Seal slam top="refused" big={refusalOf(floor.reason).clause} bottom={refusalOf(floor.reason).words} size={200} tilt={-9} />
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- the wrong variable */

/**
 * The differentiator, stated once and runnable.
 *
 * Deliberately generous about the thing it disagrees with: a spend policy is
 * the obvious design, it is obvious because it is mostly right, and nothing
 * here says otherwise. The disagreement is narrow and it is about *which
 * variable* — and the reason a guard misses this one is structural, not
 * careless. The loss is not in the object it inspects.
 */
function WrongVariable() {
  const checks = [
    ["who it may pay", "an allowlist"],
    ["how much may leave", "a cap"],
    ["which methods may run", "a list"],
    ["whether a human approved", "a switch"],
  ];
  return (
    <section>
      <Heading kicker="Part I">Every guard bounds the wrong thing</Heading>
      <p className="max-w-[58ch] text-[21px] leading-[1.45]">
        The usual way to keep an agent safe with money checks four things — and{" "}
        <span className="hl">never what you got back</span>.
      </p>

      {/* Two objects, side by side. The loss is in the one nobody inspects. */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <div className="sheet px-6 py-5">
          <div className="label text-faint">What a guard reads · the transaction</div>
          <ul className="mt-3 space-y-1.5 text-[17px]">
            {checks.map(([k, how]) => (
              <li key={k} className="flex items-baseline justify-between gap-4">
                <span>{k}</span><span className="typed text-[14px] text-faint">{how}</span>
              </li>
            ))}
          </ul>
          <p className="typed mt-4 text-[14px] text-sign">all four pass ✓</p>
        </div>

        <div className="hidden items-center justify-center lg:flex">
          <span className="font-serif text-[40px] font-extrabold text-faint" aria-hidden>≠</span>
        </div>

        <div className="sheet border-seal px-6 py-5">
          <div className="label text-seal">Where the loss is · the quote</div>
          <ul className="mt-3 space-y-1.5 text-[17px]">
            <li className="flex items-baseline justify-between gap-4"><code>amountOut</code><span className="typed text-[14px] text-faint">offered</span></li>
            <li className="flex items-baseline justify-between gap-4"><code>minAmountOut</code><span className="typed text-[14px] font-bold text-seal">guaranteed</span></li>
            <li className="flex items-baseline justify-between gap-4"><code>appFees</code><span className="typed text-[14px] text-faint">unsigned</span></li>
          </ul>
          <p className="typed mt-4 text-[14px] text-seal">off-chain. not an argument to the call.</p>
        </div>
      </div>

      <p className="mt-7 max-w-[58ch] text-[19px]">
        So the guard is not careless — it is reading the wrong object. And handing it the quote does not save
        it either: the <i>honest</i> twin of Exhibit A declares <b>100 bps</b> of slippage and guarantees a
        worst cost of <b>160</b>.
      </p>

      <div className="sheet my-7 overflow-x-auto px-6 py-5">
        <code className="typed block whitespace-pre text-[clamp(12px,1.5vw,15px)]">{`npm run policy

honest.quote.json   guard: APPROVED      real worst cost:    160 bps
worst.quote.json    guard: APPROVED      real worst cost:  10000 bps`}</code>
      </div>

      <p className="max-w-[58ch] text-[21px] leading-[1.45]">
        Same size, same place, same method — so the same answer, twice.{" "}
        <b>Hallmark bounds the price instead.</b>
      </p>
      <Source>
        the policy is written out in <code>client/src/bin/policy.ts</code> — nobody else's code, nobody named.{" "}
        <L to="/limits">What this is not →</L>
      </Source>
    </section>
  );
}

/* ------------------------------------------------------------- why now */

/**
 * The one piece of outside evidence that this is a real problem and not a
 * invented one: the regulator of the primitive has an open docket on exactly
 * this failure. Kept short on purpose — the full argument is in ARCHITECTURE.
 */
function WhyNow() {
  const rows: Array<[string, string, string]> = [
    ["the order", "FIX ExecInst 18 = 1", "the same order"],
    ["the protection", "a promise to try hard", "a number the venue signed"],
    ["enforced", "afterwards, by argument", "before anything moves"],
  ];
  return (
    <section>
      <Heading kicker="Part IV">A century-old promise, and why it has to end</Heading>
      <p className="max-w-[58ch] text-[21px] leading-[1.45]">
        Handing your trade to someone else is an old instrument. The only thing that ever protected you was a
        promise to try hard. <span className="hl">Software trades for us now</span>, and a promise is prose —
        prose is argued about afterwards.
      </p>

      <div className="mt-7 grid gap-px border-2 border-ink bg-ink sm:grid-cols-[auto_1fr_1fr]">
        <div className="label bg-paper-2 p-3 text-faint" />
        <div className="label bg-paper-2 p-3 text-faint">Equities, today</div>
        <div className="label bg-paper-2 p-3 text-faint">Hallmark</div>
        {rows.map(([k, then, now]) => (
          <Fragment key={k}>
            <div className="label bg-paper p-3 text-faint sm:whitespace-nowrap">{k}</div>
            <div className="bg-paper p-3 text-[17px] text-faint">{then}</div>
            <div className="bg-paper p-3 text-[17px] font-semibold">{now}</div>
          </Fragment>
        ))}
      </div>

      <p className="mt-6 max-w-[58ch] text-[19px]">
        The regulator agrees it is broken. On <b>24 July 2026</b> FINRA opened{" "}
        <A href="https://www.finra.org/rules-guidance/notices/26-15">Notice 26-15</A>, asking how to modernise
        best execution — §7 is about not-held orders, and its worry is that the client's protection lives in
        prose somebody else drafted.
      </p>
      <p className="mt-4 max-w-[58ch] text-[19px]">
        Nobody proposed arithmetic instead, because no equity venue signs the economics of a fill.{" "}
        <b>NEAR Intents does.</b>
      </p>
    </section>
  );
}

/* ---------------------------------------------------------- schedule B */

function ScheduleB() {
  // Four more, lower still.
  const [ref, shown] = useInView<HTMLElement>();
  const open = useQuery({ ...openCountQuery, enabled: shown });
  const total = useQuery({ queryKey: ["vault", "mandate_count"], queryFn: () => view<number>("mandate_count"), enabled: shown });
  const acct = useQuery({ queryKey: ["vault", "account"], queryFn: () => viewAccount(), enabled: shown });
  const signer = useQuery({ queryKey: ["vault", "quote_signer"], queryFn: () => view<string>("quote_signer"), staleTime: Infinity, enabled: shown });

  return (
    <section ref={ref}>
      <Heading kicker="Schedule B">The vault, as it stands</Heading>
      <div className="grid gap-x-12 md:grid-cols-2">
        <div>
          <Entry k="Agreements in force" v={<L to="/book" className="typed text-[22px] font-bold">{open.isSuccess ? <Count to={open.data} /> : "…"}</L>} />
          <Entry k="Agreements ever drawn up" v={<span className="typed text-[22px]">{total.isSuccess ? <Count to={total.data} /> : "…"}</span>} />
          <Entry k="Vault balance" v={<span className="typed">{acct.data ? <><Count to={Number(near(acct.data.amount, 3))} format={(n) => n.toFixed(3)} /> NEAR</> : "…"}</span>} />
        </div>
        <div>
          <Entry k="Contract" v={<A href={`${EXPLORER}/address/${VAULT}`}>{VAULT}</A>} />
          <Entry k="Trusted quote signer" v={<code className="text-[13px]" title={signer.data ?? SIGNER}>{short(signer.data ?? SIGNER, 14)}</code>} />
          <Entry k="A whole fill, measured" v={<A href={`${EXPLORER}/txns/GkEZhvx9iwq4eF8wUWrsS4fUsUxiV2h3AFZGppJnrsix`} className="typed">30.48 TGas</A>} />
        </div>
      </div>
      <Source>every figure above is a keyless view call; the gas figure is the v3 mainnet fill, every receipt counted (ARCHITECTURE.md).</Source>
    </section>
  );
}

/* ------------------------------------------------------------- execute */

function Execute() {
  return (
    <section className="mt-20 grid items-center gap-8 md:grid-cols-[1fr_auto]">
      <div>
        <h2 className="font-serif text-[clamp(32px,5vw,60px)] font-extrabold leading-[0.98] tracking-[-0.02em]">
          Put your terms in writing.
        </h2>
        <p className="mt-3 max-w-[52ch] text-[19px]">
          Looking costs nothing and needs no wallet. Drawing up an agreement takes one signature — and you
          see every byte of it first.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Link to="/post" className="btn btn-sign nudge">Draw up an agreement</Link>
        <Link to="/how" className="btn">How it works</Link>
      </div>
    </section>
  );
}
