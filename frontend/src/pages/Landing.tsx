import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { A, Clause, Entry, Heading, L, Seal, Source, Stamp } from "@/components/doc";
import { exhibitA } from "@/lib/exhibit";
import { EXPLORER, near, SIGNER, short, VAULT, view, viewAccount } from "@/lib/hallmark";
import { parseCheck, refusalOf } from "@/lib/price";
import { openCountQuery } from "@/lib/queries";

export function Landing() {
  return (
    <main className="doc">
      <Title />
      <Recitals />
      <Terms />
      <Invariant />
      <ExhibitA />
      <ScheduleB />
      <Execute />
    </main>
  );
}

/* --------------------------------------------------------------- the title */

function Title() {
  return (
    <section className="relative pb-6 pt-10 sm:pt-14">
      <div className="label text-faint">Agreement no. 1 · a not-held order that enforces its own execution bound</div>
      <h1 className="mt-5 font-serif font-extrabold leading-[0.92] tracking-[-0.025em] text-[clamp(44px,8.4vw,112px)]">
        <span className="struck block">Best execution is a promise.</span>
        <span className="block">It is now a <span className="hl">clause.</span></span>
      </h1>
      <p className="mt-7 max-w-[640px] text-[21px] leading-[1.45]">
        You name the worst all-in cost you will accept. Anyone may fill your order. Before anyone is paid, the
        contract reads four numbers the venue signed and refuses any fill that breaches your terms. No oracle. No
        price feed. No custodian.
      </p>
      <div className="mt-8 flex flex-wrap gap-4">
        <Link to="/book" className="btn btn-ink">Read the register</Link>
        <Link to="/post" className="btn">Draw up an agreement</Link>
        <Link to="/verify" className="btn">Verify a quote</Link>
      </div>
      <div className="pointer-events-none absolute right-0 top-24 hidden lg:block">
        <Seal slam top="refused" big="§1" bottom="10000 bps" size={176} tilt={-13} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- recitals */

function Recitals() {
  return (
    <section className="mt-10 max-w-[820px] text-[20px] leading-[1.55]">
      <p className="label mb-3">Recitals</p>
      <p className="mb-3"><b className="typed text-[15px]">WHEREAS</b> (A) a not-held order hands discretion over the
        time and price of a trade to somebody else, and for a century the only thing protecting the client was a
        promise — the best execution obligation;</p>
      <p className="mb-3"><b className="typed text-[15px]">WHEREAS</b> (B) NEAR Intents signs the economics of every
        fill, so on NEAR that promise can be a number instead;</p>
      <p className="mb-3"><b className="typed text-[15px]">WHEREAS</b> (C) a signature is not a price — a validly signed
        quote can guarantee a 99.99% loss, as <a className="lnk" href="#exhibit-a">Exhibit A</a> shows;</p>
      <p><b className="typed text-[15px]">NOW THEREFORE</b> the owner, any filler, and the contract at{" "}
        <A href={`${EXPLORER}/address/${VAULT}`}>{VAULT}</A> agree as follows.</p>
    </section>
  );
}

/* ---------------------------------------------------------------- terms */

function Terms() {
  return (
    <section>
      <Heading kicker="Part I">The terms</Heading>
      <Clause no="§1" title="The ceiling">
        The owner will pay no more than the <span className="hl">worst all-in cost</span> they name, in basis points.
        It is checked on what actually arrived, not on what was promised, so slippage, bridge fees, solver spread and
        any hidden app fee are all already inside it.
      </Clause>
      <Clause no="§2" title="The proof">
        The filler delivers the output <i>first</i>. The contract then verifies NEAR Intents' own ed25519 signature
        over the quote before crediting the filler with the input. The quote's deposit address is not signed, so
        nothing is ever sent to it.
      </Clause>
      <Clause no="§3" title="Freshness">
        A quote older than the owner's bound is refused. Age is measured from the timestamp the venue signed, never
        from the deadline, because whoever asks for a quote chooses its deadline.
      </Clause>
      <Clause no="§4" title="Remedy">
        A fill that breaches §1–§3 is refused in the same transaction, and the token contract returns the delivery
        in full. Nobody is ever holding a counterparty's funds.
      </Clause>
      <Clause no="§5" title="Settlement">
        Payouts are pulled, never pushed. A fill credits both sides; each withdraws when they like. An unregistered
        counterparty cannot block anybody else's fill.
      </Clause>
      <Clause no="§6" title="Storage">
        Whoever causes a byte to be written pays for that byte, measured, never estimated. Reaping a closed agreement
        returns what it frees.
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
      <p className="max-w-[760px] text-[19px]">
        Four signed fields and the amount that actually arrived. Every fee has already moved those numbers before the
        venue signed them, so there is nothing else to list, and nothing a filler can hide.
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
        <div className="max-w-[720px] text-[19px]">
          <p>
            A genuine NEAR Intents quote, captured on 31 October 2026. It says <b>$10 → 2.14 wNEAR</b>, which is true.
            Its guaranteed floor is <b>0.000214 wNEAR</b>, which is also true, and is what was actually promised. It
            also carries a 500 bps app fee in a field the venue does not sign.
          </p>
          {ex.isPending && <p className="typed mt-6 text-[15px] text-faint">asking {VAULT}…</p>}
          {ex.isError && <p className="typed mt-6 text-[15px] text-seal">{ex.error.message}</p>}
          {r && (
            <div className="mt-6">
              <Entry k="Did NEAR Intents sign these exact bytes?" v={r.signed ? <Stamp ink="blue">yes</Stamp> : <Stamp>no</Stamp>} />
              <Entry k="Guaranteed-worst cost (at the signed floor)" v={<b className="typed text-[22px]">{r.worstBps} bps</b>} />
              <Entry k="Cost even if honoured in full" v={<b className="typed text-[22px]">{r.fullBps} bps</b>} />
              <Entry k="The owner's ceiling" v={<span className="typed text-[22px]">300 bps</span>} />
              <Entry k="dry_check, verbatim" v={<code className="text-[13px] text-seal">{r.atFloor}</code>} />
              <Source>
                is_signed · worst_cost · realised_cost · dry_check on {VAULT}, just now. Age bound set to the
                contract's 30-day maximum so the ceiling is what is tested.{" "}
                <L to="/verify">Run it yourself →</L>
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
          <Entry k="Agreements in force" v={<L to="/book" className="typed text-[22px] font-bold">{open.data ?? "…"}</L>} />
          <Entry k="Agreements ever drawn up" v={<span className="typed text-[22px]">{total.data ?? "…"}</span>} />
          <Entry k="Vault balance" v={<span className="typed">{acct.data ? `${near(acct.data.amount, 3)} NEAR` : "…"}</span>} />
        </div>
        <div>
          <Entry k="Contract" v={<A href={`${EXPLORER}/address/${VAULT}`}>{VAULT}</A>} />
          <Entry k="Trusted quote signer" v={<code className="text-[13px]" title={signer.data ?? SIGNER}>{short(signer.data ?? SIGNER, 14)}</code>} />
          <Entry k="A whole fill, measured" v={<span className="typed">30.25 TGas</span>} />
        </div>
      </div>
      <Source>every figure above is a keyless view call; the gas figure is measured on mainnet (README).</Source>
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
        <p className="mt-3 max-w-[600px] text-[19px]">
          Reading the register, pricing a fill and verifying a quote need no wallet. Drawing up an agreement needs
          one signature — and you see every byte of it first.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Link to="/post" className="btn btn-sign">Draw up an agreement</Link>
        <Link to="/how" className="btn">How it works</Link>
      </div>
    </section>
  );
}
