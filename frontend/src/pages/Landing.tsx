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
import { EXPLORER, near, SIGNER, short, VAULT, view, viewAccount } from "@/lib/hallmark";
import { parseCheck, refusalOf } from "@/lib/price";
import { openCountQuery } from "@/lib/queries";
import { Count } from "@/motion/Count";
import { Typewriter } from "@/motion/Typewriter";

export function Landing() {
  return (
    <main className="doc">
      <Title />
      <Terms />
      <Invariant />
      <ExhibitA />
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
        refuses any fill that goes over it, measured on what actually arrived.
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
      <Heading kicker="Part I">The terms</Heading>
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
      <Heading kicker="Part II">The one invariant</Heading>
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
  const ex = useQuery({ queryKey: ["vault", "exhibit-a"], queryFn: exhibitA, staleTime: 60_000 });
  const r = ex.data;
  const floor = r ? parseCheck(r.atFloor) : null;

  return (
    <section id="exhibit-a">
      <Heading kicker="Exhibit A">A quote the venue really signed, and the contract refused</Heading>
      <div className="grid gap-10 lg:grid-cols-[1fr_auto]">
        <div className="max-w-[62ch] text-[19px]">
          <p>
            A real NEAR Intents quote from 31 October 2026. It offers <b>$10 → 2.14 wNEAR</b> — but the amount
            it actually <i>guarantees</i> is <b>0.000214 wNEAR</b>. Both numbers are true, and the venue signed
            both. Read the first one and you lose almost everything.
          </p>
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

/* ------------------------------------------------------------- why now */

/**
 * The one piece of outside evidence that this is a real problem and not a
 * invented one: the regulator of the primitive has an open docket on exactly
 * this failure. Kept short on purpose — the full argument is in ARCHITECTURE.
 */
function WhyNow() {
  const rows: Array<[string, string, string]> = [
    ["the primitive", "FIX ExecInst tag 18 = 1", "the same order"],
    ["its protection", "a promise — “reasonable diligence”", "a number the venue signed"],
    ["enforced", "after the fact, against a benchmark", "before anything moves"],
  ];
  return (
    <section>
      <Heading kicker="Part III">Why the promise needs replacing, and why now</Heading>
      <p className="max-w-[62ch] text-[21px] leading-[1.45]">
        <b>Software is starting to trade on people's behalf.</b> A not-held order is how you hand that
        discretion over, and for a century the only thing on the other side of it was a promise to try
        hard. <span className="hl">If machines execute for us, something has to bound them</span> — and a
        promise is not a bound, because a promise is prose and prose is argued about afterwards.
      </p>
      <p className="mt-4 max-w-[62ch] text-[19px]">
        That is not a hypothetical worry: the regulator of the primitive has an open docket on exactly this
        failure. On <b>24 July 2026</b> FINRA opened{" "}
        <A href="https://www.finra.org/rules-guidance/notices/26-15">Regulatory Notice 26-15</A>, asking how to
        modernise best execution under Rule 5310. Section 7 raises two concerns about not-held orders, and both
        are the same one: <b>the client's protection lives in prose somebody else drafted</b>. It also asks
        whether a safe harbor would help.
      </p>
      <div className="mt-7 grid gap-px border-2 border-ink bg-ink sm:grid-cols-[auto_1fr_1fr]">
        <div className="label bg-paper-2 p-3 text-faint" />
        <div className="label bg-paper-2 p-3 text-faint">Equities, today</div>
        <div className="label bg-paper-2 p-3 text-faint">Hallmark</div>
        {rows.map(([k, then, now]) => (
          <Fragment key={k}>
            <div className="label bg-paper p-3 text-faint sm:whitespace-nowrap">{k}</div>
            <div className="bg-paper p-3 text-[17px]">{then}</div>
            <div className="bg-paper p-3 text-[17px] font-semibold">{now}</div>
          </Fragment>
        ))}
      </div>
      <p className="mt-6 max-w-[62ch] text-[19px]">
        Nobody has proposed replacing the promise with arithmetic, because in equities no venue
        cryptographically signs the economics of a fill. <b>On NEAR there is one</b> — which is why the
        bound can be a number an agent cannot talk its way past, instead of a duty somebody owes you.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------- schedule B */

function ScheduleB() {
  const open = useQuery(openCountQuery);
  const total = useQuery({ queryKey: ["vault", "mandate_count"], queryFn: () => view<number>("mandate_count") });
  const acct = useQuery({ queryKey: ["vault", "account"], queryFn: () => viewAccount() });
  const signer = useQuery({ queryKey: ["vault", "quote_signer"], queryFn: () => view<string>("quote_signer"), staleTime: Infinity });

  return (
    <section>
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
