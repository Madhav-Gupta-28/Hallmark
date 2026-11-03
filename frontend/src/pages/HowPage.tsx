/**
 * How it works — the explanatory memorandum. Ported from web/how.html: the
 * text is the reference's; the layout is the contract's. Two of its widgets
 * are rebuilt live against the contract (the invariant on real fixtures, and
 * the freshness bound); the animated fill stepper becomes a numbered sequence.
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { A, Clause, Entry, Heading, L, Seal, Source, Stamp } from "@/components/doc";
import { EXPLORER, fixtures, VAULT, view, type MandateTerms } from "@/lib/hallmark";
import { parseCheck, refusalOf } from "@/lib/price";
import { cn } from "@/lib/utils";

const Code = ({ children }: { children: ReactNode }) => (
  <pre className="my-4 overflow-x-auto border-2 border-ink bg-paper-2 p-4 text-[13.5px] leading-relaxed">{children}</pre>
);
const P = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("my-3 max-w-[800px] text-[18.5px] leading-[1.55]", className)}>{children}</p>
);
const Note = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="my-5 max-w-[800px] border-l-4 border-ink pl-5 text-[17.5px]"><b>{title}</b> {children}</div>
);
function Table({ head, rows, mono = [] }: { head: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <div className="-mx-5 my-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="ledger text-[16px]">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={mono.includes(j) ? "typed text-[14px]" : ""}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function HowPage() {
  return (
    <main className="doc">
      <section className="pt-10">
        <div className="label text-faint">Explanatory memorandum · accompanies the agreement</div>
        <h1 className="mt-3 font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
          How the clauses are <span className="hl">enforced.</span>
        </h1>
        <nav className="typed mt-6 flex flex-wrap gap-x-5 gap-y-1 text-[15px]" aria-label="Parts">
          {[["#fill", "I · a fill"], ["#invariant", "II · the invariant"], ["#trust", "III · where the trust goes"], ["#hole", "IV · the hole we found"], ["#contract", "V · the contract"], ["#fillers", "VI · the fillers"]].map(([h, t]) => (
            <a key={h} href={h} className="lnk">{t}</a>
          ))}
        </nav>
      </section>

      <PartFill />
      <PartInvariant />
      <PartTrust />
      <PartHole />
      <PartContract />
      <PartFillers />

      <p className="mt-16 text-[19px]">
        <L to="/book">See the register and price a fill →</L> · <L to="/limits">What is still wrong with it →</L>
      </p>
    </main>
  );
}

/* ================================================================== I */

function PartFill() {
  const steps: Array<[string, string, string]> = [
    ["owner", "ft_transfer_call → vault", "Escrows the origin asset with the terms in msg. The transfer is the escrow."],
    ["filler", "get_mandates() — keyless", "Finds work by reading the register. No permission from anyone."],
    ["filler", "POST /v0/quote", "Gets a signed quote from NEAR Intents for the mandate's pair and size."],
    ["filler", "source the output", "From inventory, or bought first — carrying the price risk in between."],
    ["filler", "deliver it to the vault", "ft_transfer_call of the destination asset, with the signed quote in msg."],
    ["vault", "verify, synchronously", "sha256 → base58 → ed25519 against the venue's key, over the exact bytes."],
    ["vault", "bound the realised cost", "On what actually arrived, against the owner's ceiling and freshness bound."],
    ["vault", "credit both legs", "Owner credited the output, filler the input. Or refuse, and the token refunds."],
    ["owner", "withdraw(destination)", "Pull, never push: each side withdraws when it likes."],
  ];
  return (
    <section id="fill">
      <Heading kicker="Part I">A fill, step by step</Heading>
      <h3 className="font-serif text-[26px] font-bold">The filler delivers the output first. That is the load-bearing decision.</h3>
      <P>
        Watch where the money is at each step. The output is inside the vault before the input is credited to
        anybody, so there is no interval in which either side is exposed — and no cross-contract call in the
        verification path, so there is nothing to roll back.
      </P>
      <ol className="my-6">
        {steps.map(([who, what, why], i) => (
          <li key={i} className="grid grid-cols-[3rem_6rem_1fr] items-baseline gap-x-4 border-b border-ink/25 py-3 sm:grid-cols-[3rem_6rem_16rem_1fr]">
            <span className="typed text-[22px] font-bold">{i + 1}</span>
            <span className={cn("label", who === "vault" ? "text-sign" : "text-faint")}>{who}</span>
            <code className="font-bold max-sm:col-span-1 max-sm:col-start-3">{what}</code>
            <span className="text-[17px] max-sm:col-span-3 max-sm:col-start-1">{why}</span>
          </li>
        ))}
      </ol>
      <Clause no="(a)" title="No unsigned field is trusted">
        <code>depositAddress</code> is never used, because the vault never sends the owner's funds anywhere a filler nominated.
      </Clause>
      <Clause no="(b)" title="No attribution problem">
        The delivered amount is a function argument, not a balance delta — so concurrent fills cannot be confused, and
        no filler can claim another's delivery.
      </Clause>
      <Clause no="(c)" title="No custody window">
        Step 5 completes before step 8 begins. Nobody ever holds a counterparty's funds, so there is nothing to
        misappropriate and nothing to unwind.
      </Clause>
      <Note title="The cost of this choice, stated.">
        The filler must front the output, so it needs destination-asset inventory or must source it first and carry
        the price risk in between. That is what a dealer does, and it is the price of closing a hole that cannot
        otherwise be closed.
      </Note>
    </section>
  );
}

/* ================================================================= II */

function PartInvariant() {
  return (
    <section id="invariant">
      <Heading kicker="Part II">The invariant, worked on real fixtures</Heading>
      <P>
        Both USD marks are inside the signed payload, so the contract reads bytes it was handed and does integer
        arithmetic. Pick a fixture; the numbers are the file's, and the contract's answer is a live view call.
      </P>
      <InvariantWidget />

      <h3 className="mt-12 font-serif text-[28px] font-bold">Canonicalisation, deleted rather than solved</h3>
      <P>
        Re-serialising JSON inside a contract to re-derive a hash is a reliable way to lose a week: Rust and TypeScript
        must agree byte-for-byte on key order, number formatting and unicode escaping, forever.
      </P>
      <P>
        Hallmark has no canonicalisation code in Rust at all. The client builds the canonical byte string; the
        contract is handed those exact bytes and does this:
      </P>
      <Code>{`sha256(bytes)
  → base58
  → ed25519_verify(sig, that string, signer)
  → from_slice(THE SAME bytes)`}</Code>
      <P>
        Hash first, parse second, same bytes both times. If a single byte differs from what the venue signed,
        verification fails before any field is read. <code>every_single_byte_is_covered_by_the_signature</code>{" "}
        asserts it by flipping each of the 692 bytes in turn.
      </P>
      <Note title="The signature is over the UTF-8 of the base58 string of the digest, not over the digest.">
        This is the single most load-bearing implementation detail in the project; getting it wrong produces a
        verifier that rejects every real quote.
      </Note>
      <P>The canonicaliser exists several times, on purpose — and all agree, byte for byte and hash for hash, on all three fixtures:</P>
      <Table head={["where", "implementation"]} mono={[0]} rows={[
        ["fixtures/mkfix.py", "Python + from-scratch RFC-8032 ed25519"],
        ["client/src/lib/canonical.ts", "TypeScript, json-stable-stringify"],
        ["web/assets/hallmark.js", "~20 lines of browser JS, no dependency"],
        ["frontend/src/lib/hallmark.ts", "the same, ported to TypeScript — and tested against the other two on every build"],
      ]} />

      <h3 className="mt-12 font-serif text-[28px] font-bold">Rounding has exactly one safe direction</h3>
      <P>Every truncation must make the reported cost larger, never smaller — a bound that understates cost is not a bound.</P>
      <Table head={["step", "rounds", "effect on reported cost"]} mono={[0]} rows={[
        ["parse_fixed(amountOutUsd)", "down", "understates the output's value → cost up ✓"],
        ["value_ratio = outUsd·1e9/inUsd", "down", "cost up ✓"],
        ["fill_ratio = delivered·1e9/amountOut", "down", "cost up ✓"],
        ["kept = value·fill/1e9", "down", "cost up ✓"],
        ["bps = shortfall/1e9", <b key="u">must round UP</b>, "← the one that needed fixing"],
      ]} />
      <P>
        Found by running the code, not by reasoning about it. The final division was truncating. On the honest fixture
        the exact cost is 159.348 bps; truncation reported 159, understating the bound. It now uses{" "}
        <code>div_ceil</code> and reports 160, pinned by <code>the_reported_cost_is_never_below_the_true_cost</code>.
      </P>
      <Note title="256-bit intermediates are not optional.">
        wNEAR has 24 decimals, so a $1M order is ~1e30 base units and delivered × 1e9 is ~1e39 — which overflows
        u128 (max ≈ 3.4e38). <code>mul_div</code> computes a·b as a 256-bit (hi, lo) pair and does restoring long
        division, 128 iterations.
      </Note>
    </section>
  );
}

function InvariantWidget() {
  const [which, setWhich] = useState<"honest" | "worst" | "sandbox">("honest");
  const [at, setAt] = useState<"floor" | "full">("floor");
  const fx = useQuery({ queryKey: ["fixtures"], queryFn: fixtures, staleTime: Infinity });
  const f = fx.data?.[which];
  const q = f ? JSON.parse(f.canonical) : null;
  const delivered = q ? (at === "floor" ? q.minAmountOut : q.amountOut) : null;
  const cost = useQuery({
    queryKey: ["vault", "realised_cost", which, at],
    queryFn: () => view<number>("realised_cost", { canonical: f!.canonical, delivered }),
    enabled: !!f,
  });

  return (
    <div className="sheet my-6 p-5 sm:p-6">
      <p className="text-[18px] leading-[2.1]">
        Price the <select className="blank cursor-pointer" value={which} onChange={(e) => setWhich(e.target.value as typeof which)} aria-label="fixture">
          <option value="honest">honest</option><option value="worst">worst — the 99.99% one</option><option value="sandbox">sandbox</option>
        </select> capture, delivering{" "}
        <select className="blank cursor-pointer" value={at} onChange={(e) => setAt(e.target.value as typeof at)} aria-label="delivered">
          <option value="floor">minAmountOut — the guaranteed floor</option><option value="full">amountOut — honoured in full</option>
        </select>.
      </p>
      {q && (
        <div className="mt-3 grid gap-x-10 md:grid-cols-2">
          <div>
            <Entry k="amountInUsd" v={<code>{q.amountInUsd}</code>} />
            <Entry k="amountOutUsd" v={<code>{q.amountOutUsd}</code>} />
            <Entry k="amountOut" v={<code className="break-all">{q.amountOut}</code>} />
            <Entry k="delivered" v={<code className="break-all text-sign">{delivered}</code>} />
          </div>
          <div className="flex flex-col justify-center py-4">
            <code className="typed text-[14px]">cost = 1 − (amountOutUsd × delivered ÷ amountOut) ÷ amountInUsd</code>
            <p className="mt-4 text-[17px]">
              {VAULT} answers{" "}
              <b className={cn("typed text-[30px]", (cost.data ?? 0) > 300 ? "text-seal" : "text-sign")}>
                {cost.isSuccess ? `${cost.data} bps` : cost.isError ? "—" : "…"}
              </b>
            </p>
          </div>
        </div>
      )}
      <Source>realised_cost on {VAULT} — arithmetic only; the signature is checked by is_signed and dry_check.</Source>
    </div>
  );
}

/* ================================================================ III */

function PartTrust() {
  return (
    <section id="trust">
      <Heading kicker="Part III">Where the trust goes — this design against the alternatives</Heading>
      <P>
        Bounded delegated execution is a known pattern. The claim here is narrow and has to stay narrow. What differs
        is who the price authority is, and that is the only column that matters.
      </P>
      <Table head={["system", "who is the price authority", "enforced", "bounds", "chains"]} rows={[
        ["agent-wallet-sdk #98", "“a source independent of the swap RPC”, unnamed", "off-chain, in the SDK", "token floor", "1"],
        ["TreasuryPilot #542", "a signer the project allowlists", "on-chain", "token floor", "1"],
        ["Envelope", "pool reserves at trade time", "on-chain", "token floor", "1"],
        ["ERC-8377 (draft)", "a reference oracle", "on-chain", "relative slippage", "1"],
        [<b key="h">Hallmark</b>, <b key="c">the counterparty itself</b>, "on-chain", <b key="r">realised all-in cost, in USD</b>, "38"],
      ]} />
      <Clause no="(a)" title="An SDK check binds the honest agent and not the compromised one">
        A prompt-injected agent simply does not call the SDK. This is the single most common shape of a wrong answer to this problem.
      </Clause>
      <Clause no="(b)" title="TreasuryPilot moves the trust rather than removing it">
        Its EIP-712 quotes, nonce, expiry and route hash are all correct — but the signer is one the project controls.
        If that signer lies, the treasury is drained with a valid signature.
      </Clause>
      <Clause no="(c)" title="A token floor bounds one leg">
        <code>minAmountOut</code> alone says nothing about whether the floor is a good floor. Only the USD marks turn it into a cost.
      </Clause>
    </section>
  );
}

/* ================================================================= IV */

function PartHole() {
  return (
    <section id="hole">
      <Heading kicker="Part IV">The free option we wrote against our own users</Heading>
      <h3 className="font-serif text-[26px] font-bold">v1 was live on mainnet with a hole that defeated the headline claim.</h3>
      <P>
        The bound is denominated in <code>amountInUsd</code> and <code>amountOutUsd</code>. Those numbers were true when
        the venue signed, and not necessarily now. v1's only freshness check was the quote's own deadline:
      </P>
      <Code>{`// v1
if now_secs >= deadline_secs {
    return Err(Refusal::QuoteExpired { .. })
}`}</Code>
      <P><code>deadline</code> is supplied by whoever requests the quote, and 1Click signs it unquestioned. Measured live on 2026-11-01:</P>
      <Table head={["asked", "signed?", "valid for"]} mono={[0, 2]} rows={[
        ["+ 1 day", "true", "1 day"], ["+ 30 days", "true", "30 days"], ["+ 365 days", "true", "365 days"], ["+ 3650 days", "true", "3650 days"],
      ]} />
      <P>Ten years. And <code>dry:true</code> quotes are free, unauthenticated, and still signed. So the attack costs nothing to set up:</P>
      <ol className="my-4 max-w-[800px] list-decimal pl-7 text-[18px] leading-[1.6]">
        <li>Ask for a quote matching an open mandate, deadline years out. Free.</li>
        <li>Do it repeatedly and keep them. You now hold a library of free options on the owner's escrow, each struck at the prices of the day it was minted.</li>
        <li>Wait. When the market moves, exercise whichever became profitable.</li>
        <li>The vault prices it from the quote's own frozen marks, reports a number inside the ceiling, and releases the escrow.</li>
      </ol>
      <P>
        The owner's <code>max_cost_bps</code> was enforced exactly — against a market that no longer existed. The
        realised loss is the whole adverse move and is unbounded.
      </P>
      <div className="my-6 grid gap-6 md:grid-cols-2">
        <div><p className="label mb-2">against v1, 2026-11-01</p><Code>{`ALLOWED at 60 bps realised all-in cost,
filler earns 10000000 origin units`}</Code></div>
        <div><p className="label mb-2">against v2, 2026-11-02</p><Code>{`REFUSED QuoteTooOld {
  signed_at_secs: 1793297130,
  now_secs: 1793557929,
  max_age_secs: 300 }`}</Code></div>
      </div>
      <Clause no="fix" title="The fix was a field already inside the signature">
        <code>timestamp</code> — when the venue signed — was in the canonical bytes all along. v1 simply never read it.
        <Code>{`// v2 onwards
let signed_at = parse_iso8601_secs(&q.timestamp);
if now_secs > signed_at + m.max_quote_age_secs {
    return Err(Refusal::QuoteTooOld { .. })
}`}</Code>
        Being signed and being trustworthy are different properties. <code>timestamp</code> is written by the venue.{" "}
        <code>deadline</code> is written by the counterparty.
      </Clause>

      <h3 className="mt-12 font-serif text-[28px] font-bold">How fresh do you insist on?</h3>
      <P>
        This is the real control an owner has. Move <code>max_quote_age_secs</code> and watch where the bound falls
        relative to how old this capture actually is. Nothing is simulated: the age is the real age of the capture,
        the clock is the chain's, and every ruling is <code>dry_check</code> answered by {VAULT} with exactly the
        terms shown.
      </P>
      <FreshnessWidget />

      <h3 className="mt-12 font-serif text-[28px] font-bold">And a real transaction, not a simulation</h3>
      <P>A quote was banked for 326 seconds against a 300-second bound, then a fill was actually broadcast with real USDT. The vault refused it and the tokens came back.</P>
      <Table head={["", ""]} rows={[
        ["tx", <A key="t" href={`${EXPLORER}/txns/3JKAnmbAnQKM141iT3fd4Pk2jhTLjBmmYC3Gk4vp6Zyc`}>3JKAnmbAnQKM141iT3fd4Pk2jhTLjBmmYC3Gk4vp6Zyc</A>],
        ["outer status", <span key="o"><code>SuccessValue</code> ← the ft_transfer_call succeeded</span>],
        ["receipt 1", <code key="r" className="text-seal">Smart contract panicked: REFUSED QuoteTooOld {"{"} signed_at_secs: 1793558547, now_secs: 1793558888, max_age_secs: 300 {"}"}</code>],
        ["ft_transfer", "d3bc151a… → hallmarkfi.near 157389 ← delivery in"],
        ["ft_transfer", "hallmarkfi.near → d3bc151a… 157389 ← refunded out"],
        ["escrow · filler credit", "unchanged · unchanged"],
      ]} />
      <Note title="A refused fill is a successful transaction.">
        NEP-141 catches the receiver's panic in order to make the refund work, so the outer status is{" "}
        <code>SuccessValue</code> and the refusal is buried in an inner receipt. Anything reporting on a fill has to
        read <code>receipts_outcome</code> — our own reference filler called a refused fill a filled one until this was
        found. (This app's record of execution reads the vault's own receipt for exactly this reason.)
      </Note>

      <h3 className="mt-12 font-serif text-[28px] font-bold">Why an audit found these, and reasoning did not</h3>
      <Clause no="(a)" title="The rounding bug">Exact cost 159.348 bps; the contract reported 159. A bound that understates cost is not a bound. Found by running the arithmetic, not reading it.</Clause>
      <Clause no="(b)" title="The storage bug, twice">A fixed byte charge left the vault paying for strangers' state. The first fix refunded more than it freed, so open-and-cancel in a loop still drained it. Both caught by printing real byte counts.</Clause>
      <Clause no="(c)" title="The official example">NEAR's own near-intents agent skill returns HTTP 400 run verbatim — it omits four fields its own docs list as optional. Found by running it.</Clause>
      <Note title="The quieter failure is in Exhibit A.">
        Honoured in full that quote still costs 503 bps, because 500 bps of <code>appFees</code> are already baked into
        the signed <code>amountOutUsd</code>. The contract cannot read <code>appFees</code> — it is not in the bytes
        being verified — and prices it to the basis point regardless.
      </Note>
    </section>
  );
}

const AGES: Array<[number, string]> = [
  [60, "1 min"], [300, "5 min"], [3600, "1 hour"], [86_400, "1 day"], [3 * 86_400, "3 days"], [7 * 86_400, "7 days"], [30 * 86_400, "30 days"],
];

function FreshnessWidget() {
  const [i, setI] = useState(1);
  const fx = useQuery({ queryKey: ["fixtures"], queryFn: fixtures, staleTime: Infinity });
  const f = fx.data?.honest;
  const maxAge = AGES[i][0];
  const age = useQuery({
    queryKey: ["vault", "quote_age_secs", "honest"],
    queryFn: () => view<string>("quote_age_secs", { canonical: f!.canonical }),
    enabled: !!f,
  });
  const verdict = useQuery({
    queryKey: ["vault", "dry_check", "honest-age", maxAge],
    queryFn: () => {
      const q = JSON.parse(f!.canonical);
      const terms: MandateTerms = {
        origin_asset: q.originAsset, destination_asset: q.destinationAsset, recipient: q.recipient,
        max_cost_bps: 300, max_fill: q.amountIn, max_quote_age_secs: maxAge, expiry_ns: "4000000000000000000",
      };
      return view<string>("dry_check", { canonical: f!.canonical, signature: f!.signature, terms, delivered: q.amountOut });
    },
    enabled: !!f,
  });
  const c = verdict.data ? parseCheck(verdict.data) : null;
  const ageSecs = age.data ? Number(age.data) : null;

  return (
    <div className="sheet my-6 grid items-center gap-6 p-5 sm:grid-cols-[1fr_auto] sm:p-6">
      <div>
        <p className="text-[18px]">
          The honest capture was signed <b className="typed">{ageSecs !== null ? `${(ageSecs / 86_400).toFixed(1)} days` : "…"}</b> ago.
          Refuse quotes older than <b className="typed text-sign">{AGES[i][1]}</b>:
        </p>
        <input type="range" min={0} max={AGES.length - 1} step={1} value={i} onChange={(e) => setI(Number(e.target.value))}
          className="mt-4 w-full accent-[var(--ink)]" aria-label="max quote age" />
        <div className="typed mt-1 flex justify-between text-[12px] text-faint">{AGES.map(([, l]) => <span key={l}>{l}</span>)}</div>
        <code className={cn("mt-4 block break-all text-[13px]", c?.allowed ? "text-sign" : "text-seal")}>{verdict.data ?? "…"}</code>
        <p className="typed mt-2 text-[12.5px] text-faint">↳ ceiling 300 bps, delivering amountOut. The quote is validly signed at every point on this scale; the only thing tested is its age.</p>
      </div>
      <div className="flex justify-center">
        {c && (c.allowed
          ? <Seal key={`ok${i}`} slam ink="blue" top="honoured" big={`${c.costBps}`} bottom="bps" size={150} />
          : <Seal key={`no${i}`} slam top="refused" big={refusalOf(c.reason).clause} bottom={refusalOf(c.reason).words} size={150} />)}
      </div>
    </div>
  );
}

/* ================================================================== V */

function PartContract() {
  return (
    <section id="contract">
      <Heading kicker="Part V">The contract</Heading>
      <P>
        Twenty-three exported methods, nine typed refusals, sixteen invariants, and one path that moves value. No admin
        function, no pause — and no oracle, because the price authority is the counterparty's own signature.
      </P>

      <h3 className="mt-8 font-serif text-[28px] font-bold">One path moves value</h3>
      <P>Every state change that moves a token starts in <code>ft_on_transfer</code>, which NEP-141 calls when somebody <code>ft_transfer_call</code>s into the vault. That single call carries everything verification needs:</P>
      <Table head={["from", "the vault learns"]} mono={[0]} rows={[
        ["env::predecessor_account_id()", "which token arrived"], ["sender_id", "who sent it"], ["amount", "how much arrived"], ["msg", "the canonical quote bytes, the signature, the mandate id"],
      ]} />
      <P>Synchronous, with no cross-contract call — so there is no rollback path, no in-flight record and no stuck state. Payouts are pull, not push, so a counterparty who is not storage-registered on a token cannot brick a fill for anybody else.</P>
      <Table head={["action", "legal token", "effect"]} mono={[0]} rows={[
        ["open", "the mandate's origin", "create a funded mandate"], ["fund", "that mandate's origin", "top up the escrow"], ["fill", "the destination", "the transfer is the delivery"],
      ]} />

      <h3 className="mt-12 font-serif text-[28px] font-bold">What the owner commits to</h3>
      <P>Four numbers and two assets. No policy language, no allowlist, no per-protocol configuration. A bound nobody can read is a bound nobody trusts.</P>
      <Code>{`pub struct Mandate {
    pub origin_asset: String,          // nep141:…
    pub destination_asset: String,
    pub recipient: String,             // the signed \`recipient\` a quote must name
    pub max_cost_bps: u32,             // the whole point
    pub max_fill: U128,                // largest single fill, origin base units
    pub max_quote_age_secs: u32,       // how stale the USD marks may be
    pub expiry_ns: U64,                // u64 as a string, so a JS client
}                                      // cannot silently lose precision`}</Code>
      <p className="label mt-8">Eight kinds of terms open refuses outright</p>
      <Table head={["refused", "because"]} mono={[0]} rows={[
        ["origin_asset == destination_asset", "one token would match both the funding path and the delivery path"],
        ["destination_asset not nep141:", "credits are paid out via token_account(), which understands nep141 ids only"],
        ["max_cost_bps > 10_000", "a ceiling above 100% bounds nothing"],
        ["max_fill == 0", "nothing could ever fill"],
        ["max_quote_age_secs == 0", "nothing could ever fill"],
        ["max_quote_age_secs > 30 days", "a ceiling priced in month-old USD marks is decoration"],
        ["expiry_ns already past", "nothing could ever fill"],
        ["recipient != this vault", "the quote would pay somebody else and the delivery could not be verified"],
      ]} />

      <h3 className="mt-12 font-serif text-[28px] font-bold">The exported surface</h3>
      <P>Twenty-three methods in <code>contract/src/lib.rs</code>. The thirteen views are the proof surface — every guarantee can be exercised with no key, no funds and no deposit.</P>
      <Table head={["method", "kind", "purpose"]} mono={[0]} rows={[
        ["ft_on_transfer", "call (via a token)", "open · fund · fill — the one path that moves value"],
        ["storage_deposit", "call · payable", "prepay for the state you will create"],
        ["storage_withdraw", "call · 1 yocto", "take back prepaid storage no record is using"],
        ["withdraw", "call · 1 yocto", "pull a credit in one token"],
        ["cancel", "call · owner", "close a mandate; unspent escrow becomes a credit"],
        ["reap", "call · owner", "delete a closed record; refund the bytes it frees"],
        ["new · migrate", "init · private", "deploy; supersede state while the key is held"],
        ["resolve_withdraw · resolve_storage_withdraw", "private callback", "restore a balance if a payout fails"],
        ["get_mandates · get_mandate", "view", "the register, and one agreement"],
        ["mandate_count · open_mandate_count", "view", "ever drawn up · in force"],
        ["get_credit · storage_balance_of · storage_cost_estimate", "view", "what an account is owed, has prepaid, should prepay"],
        ["is_signed · quote_signer", "view", "did the venue sign these bytes, and with which key"],
        ["worst_cost · realised_cost · quote_age_secs", "view", "arithmetic on a quote — no signature check"],
        ["dry_check", "view", "the full check, exactly as a fill runs it"],
      ]} />
      <Note title="Two views deliberately do not check the signature.">
        <code>worst_cost</code> and <code>realised_cost</code> price whatever bytes they are handed — that is what makes
        them useful on a quote you are still deciding about, and why <code>dry_check</code>, which does verify, is the
        one a filler consults before spending anything.
      </Note>

      <p className="label mt-10">Sixteen invariants, each naming what enforces it</p>
      <Table head={["#", "invariant", "enforced by"]} mono={[0]} rows={[
        ["1", "No token is credited out unless check() returned Ok", "the Err arm panics before either credit"],
        ["2", "reported_cost ≥ true_cost, always", "div_ceil on the final division"],
        ["3", "The bytes hashed and the bytes parsed are the same bytes", "verify canonical, then from_slice(canonical)"],
        ["4", "No method reads a field outside the signed set", "SignedQuote has no such field — a compile error"],
        ["5", "The verification path makes no cross-contract calls", "all Promise sites are in the payout methods"],
        ["6", "The output is in the vault before the input is credited", "delivered is an ft_on_transfer argument"],
        ["7", "A mandate never credits out more origin asset than its escrow", "require!(amount_in <= rec.escrow.0)"],
        ["8", "Realised cost, filler spread included, never exceeds the ceiling", "cost_bps(&q, delivered) > max_cost_bps refuses"],
        ["9", "No admin function, no pause, no upgrade method", "there is no such method"],
        ["10", "A failed payout restores the credit rather than burning it", "resolve_withdraw re-adds on Err"],
        ["11", "An action cannot be performed with the wrong token", "asset id is derived from the predecessor"],
        ["12", "The USD marks are no older than the owner allowed", "checked against the signed timestamp"],
        ["13", "No field the counterparty chooses is ever used as a bound", "depositAddress unread; deadline never a freshness test"],
        ["14", "The vault never stakes NEAR for state anyone else created", "every writing path ends in settle_storage"],
        ["15", "Its storage is always covered by a prepayment not yet refunded", "reap refunds only measured bytes freed"],
        ["16", "A signature is 64 bytes or it is refused", "decode_signature never zero-pads"],
      ]} />

      <h3 className="mt-12 font-serif text-[28px] font-bold">Whoever causes a byte to be written pays for that byte</h3>
      <P>
        NEAR stakes part of an account's balance per byte of state it holds, so somebody has to pay for a mandate's
        record. v1's answer was the vault, which gave a stranger about ten times leverage against it: roughly ten
        cents of gas and a live vault could no longer write state at all. v2 charged a fixed 1,536 bytes — also wrong,
        and its first version refunded more on cancel than it freed. v3 stops guessing: one helper runs at the end of
        every path that writes state, diffs <code>env::storage_usage()</code>, and charges the caller exactly that.
      </P>
      <Code>{`fn settle_storage(&mut self, who: &AccountId, before: u64) {
    self.mandates.flush();
    self.open_ids.flush();
    self.credits.flush();
    let after = env::storage_usage();
    if after > before {
        let owed = bytes_to_near(after - before);
        require!(balance >= owed, "prepay storage first: …");
        // deduct
    } else if before > after {
        // credit back bytes_to_near(before - after)
    }
}`}</Code>
      <div className="grid gap-x-12 md:grid-cols-2">
        <div>
          <p className="label mt-4">Measured on mainnet, to the byte</p>
          <Table head={["state", "bytes", "NEAR"]} mono={[1, 2]} rows={[
            ["a mandate record", "296", "0.00296"], ["its open-id index entry", "228", "0.00228"], ["a credit slot", "145", "0.00145"], ["a prepaid-storage row", "74", "0.00074"],
          ]} />
        </div>
        <div>
          <p className="label mt-4">Who pays for what</p>
          <Table head={["call", "charged to"]} mono={[0]} rows={[
            ["open", "the owner — record + index entry"], ["fill", "the filler — the credit slots it creates"], ["fund", "nothing — it writes no new state"],
            ["cancel", "the net: index entry out, maybe a credit slot in"], ["withdraw", "refunds the slot — once the payout lands"], ["reap", "refunds exactly what deleting the record frees"],
          ]} />
        </div>
      </div>

      <h3 className="mt-12 font-serif text-[28px] font-bold">What it costs to run, and what proves it</h3>
      <div className="grid gap-x-12 md:grid-cols-3">
        <Entry k="a whole fill, on mainnet" v={<b className="typed text-[22px]">30.48 TGas</b>} />
        <Entry k="the verification itself" v={<b className="typed text-[22px]">7.8 TGas</b>} />
        <Entry k="tests, from a clean clone" v={<b className="typed text-[22px]">58 + 54</b>} />
      </div>
      <P className="text-[16.5px]">
        The whole fill counts every receipt — the filler's ft_transfer_call, the token's hop, sha256 + ed25519_verify,
        the invariant, and both credits: 10% of one transaction's limit. 58 Rust tests (30 unit, 28 against a real
        sandbox node) plus 54 client assertions; no network, no key, no funds.
      </P>
      <Note title="The toolchain trap.">
        nearcore's VM only accepts MVP WebAssembly. From rustc 1.87 on, the output is unusable — and{" "}
        <code>DeployContract</code> still succeeds, because deploying does not compile the module. Every subsequent call
        fails with <code>CompilationError(PrepareError(Deserialization))</code>. Hence near-sdk <code>=5.24.1</code>,
        near-sys <code>=0.2.9</code>, and a 1.86 wasm toolchain via <code>./build.sh</code>.
      </Note>
    </section>
  );
}

/* ================================================================= VI */

function PartFillers() {
  return (
    <section id="fillers">
      <Heading kicker="Part VI">The fillers</Heading>
      <Table head={["filler", "strategy", "written from", "what it proves"]} mono={[0]} rows={[
        ["bin/fill.ts", "splits the spread — delivers halfway between the venue's floor and its expected fill", "the architecture", "the reference; asks the contract for a verdict before spending anything"],
        ["fillers/edge.ts", "patient — fills only when its spread clears a floor it sets, and computes the cost itself", "§2.1 and §5.3 alone", "an independent implementation of the invariant; exits non-zero if it ever disagrees with the contract"],
        ["fillers/adapted.ts", "the official NEAR Intents agent flow, pointed at a vault", "near/agent-skills, skill near-intents", "what a stranger's agent must change to become a filler — the diff is the claim"],
      ]} />

      <h3 className="mt-10 font-serif text-[28px] font-bold">The race, on mainnet</h3>
      <P>One live signed quote, one second old, three agents. All three inside the owner's ceiling, disagreeing only about strategy — which is the whole claim: the mandate does not care who fills it.</P>
      <Table head={["filler", "realised", "delivers", "", "why"]} mono={[1, 2]} rows={[
        ["fill.ts (reference)", "119 bps", "0.156681", <Stamp key="a" ink="blue">within</Stamp>, "splits the spread"],
        ["edge.ts (independent)", "169 bps", "0.155894", <Stamp key="b" ink="blue">within</Stamp>, "needs 40 bps of edge"],
        ["adapted.ts (official agent)", "69 bps", "0.157469", <Stamp key="c" ink="blue">within</Stamp>, "delivers the expected fill"],
      ]} />
      <P className="typed text-[14px] text-faint">mandate #1 · wNEAR → USDT · ceiling 300 bps · the venue's floor 0.155894 · its expected fill 0.157469 · all three implementations of the invariant agree.</P>
      <Note title="And the limit, stated.">
        First-come-first-served means whoever lands first wins, not whoever is cheapest. The owner gets their ceiling,
        not the best price in the market. An auction window is the natural next version and is not claimed for v1.
      </Note>

      <h3 className="mt-10 font-serif text-[28px] font-bold">Turning NEAR's own agent into a filler</h3>
      <P>The official flow — fetchTokens → getQuote(dry:false) → send deposit to quote.depositAddress → submitDeposit → pollStatus — with four changes, and nothing else:</P>
      <Clause no="[1]" title="is told what to swap → reads the register">reads <code>get_mandates()</code> — a keyless view — and takes the pair, the size and the ceiling from the mandate. The work comes from the chain.</Clause>
      <Clause no="[2]" title="recipient is the agent → recipient is the vault">recipient is inside the signature, so a quote addressed anywhere else is refused <code>WrongRecipient</code>.</Clause>
      <Clause no="[3]" title="sends the origin to depositAddress → sends the destination to the vault">The load-bearing one. <code>depositAddress</code> is not covered by the signature, so a filler should not trust it and the vault must not.</Clause>
      <Clause no="[4]" title="submitDeposit, then pollStatus → neither">The fill settles inside <code>ft_on_transfer</code>, so the receipt is the terminal state. Nothing to poll, nothing in flight.</Clause>
      <Note title="And a [0] fix, because the official example does not run.">
        Its <code>getQuote</code> omits four fields its own docs list as optional; against the live API on 2026-11-02
        that is HTTP 400. Where documentation disagrees with the network, the network wins, and the disagreement gets
        recorded.
      </Note>

      <h3 className="mt-10 font-serif text-[28px] font-bold">Why a stranger would bother</h3>
      <Clause no="(a)" title="The spread is the whole fee, so there is no fee field">
        The filler delivers an amount of its own choosing, at or above the signed floor; its compensation is what it
        keeps. That is already inside the owner's ceiling, because the ceiling is enforced on the realised cost. For
        scale: 1Click's own rake is 20 bps.
      </Clause>
      <Clause no="(b)" title="The capital requirement is real, and is the price of closing the hole">
        Inventory — hold the destination asset, lowest latency, highest capital. Or source-then-deliver — buy the
        output first and carry the price risk in between, which is exactly the risk the spread pays for.
      </Clause>
      <Clause no="(c)" title="The second incentive works at zero volume">
        Every fill emits a receipt bound to the filler's account, so a filler accumulates a provable execution record
        rather than a self-reported one.
        <Code>{`EVENT_JSON:{"standard":"hallmark","version":"1.0.0","event":"filled",
  "data":[{"mandate_id":"1","filler":"d3bc151a…b7bd484",
           "amount_in":"40000000000000000000000","delivered":"157389",
           "cost_bps":74,"ceiling_bps":300}]}`}</Code>
      </Clause>
      <Note title="What is not claimed.">
        There is no third-party filler ecosystem. Three fillers, all written by us or adapted by us. What they show is
        that the mandate does not care who fills it, and that an independent reading of the invariant agrees with the
        chain on live quotes.
      </Note>
    </section>
  );
}
