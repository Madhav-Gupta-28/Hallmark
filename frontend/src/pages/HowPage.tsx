/**
 * How it works — the explanatory memorandum, figure first.
 *
 * Every part leads with one exhibit and one sentence a first-time reader can
 * stop at; the full text of the clause is kept, word for word where it
 * mattered, in the fold under each figure. The figures are live where the
 * chain has something to say (the gauntlet, the cost, the freshness bound).
 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { A, Entry, L, Seal } from "@/components/doc";
import { Figure } from "@/components/figure";
import { EXPLORER, fixtures, VAULT, view, type MandateTerms } from "@/lib/hallmark";
import { parseCheck, refusalOf } from "@/lib/price";
import { cn } from "@/lib/utils";
import {
  CostGauge, FillFlow, Gauntlet, HoleTimeline, InvariantWall, MandateForm, OnePath, RaceRuler, Redline, StorageBars,
} from "./how/figures";

const Code = ({ children }: { children: ReactNode }) => (
  <pre className="my-3 overflow-x-auto border-2 border-ink bg-paper-2 p-3 text-[13px] leading-relaxed">{children}</pre>
);

export function HowPage() {
  return (
    <main className="doc">
      <section className="pt-10">
        <h1 className="font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
          How the clauses are <span className="hl">enforced.</span>
        </h1>
        <p className="mt-5 max-w-[640px] text-[20px]">
          Three figures. Each one is the whole idea of its section — every other
          diagram, and every word of the fine print, is folded underneath it.
        </p>
        <nav className="typed mt-6 flex flex-wrap gap-x-5 gap-y-1 text-[15px]" aria-label="Figures">
          {[["#fill", "1 · the filler pays first"], ["#cost", "2 · the cost"], ["#bound", "3 · the bound"]].map(([h, t]) => (
            <a key={h} href={h} className="lnk">{t}</a>
          ))}
        </nav>
      </section>

      {/* ------------------------------------------------------- 1 · mechanism */}
      <Figure id="fill" no="1" title="The filler delivers first"
        takeaway={<>The output is inside the vault, and checked, <span className="hl">before</span> anybody is paid. There is no moment when either side is exposed.</>}
        full={<>
          <p>Watch where the money is at each step. The output is inside the vault before the input is credited to anybody, so there is no interval in which either side is exposed — and no cross-contract call in the verification path, so there is nothing to roll back.</p>
          <p><b>No unsigned field is trusted.</b> <code>depositAddress</code> is never used, because the vault never sends the owner's funds anywhere a filler nominated.</p>
          <p><b>No attribution problem.</b> The delivered amount is a function argument, not a balance delta — so concurrent fills cannot be confused, and no filler can claim another's delivery.</p>
          <p><b>No custody window.</b> Step 5 completes before step 8 begins. Nobody ever holds a counterparty's funds, so there is nothing to misappropriate and nothing to unwind.</p>
          <p><b>The cost of this choice, stated.</b> The filler must front the output, so it needs destination-asset inventory or must source it first and carry the price risk in between. That is what a dealer does, and it is the price of closing a hole that cannot otherwise be closed.</p>
          <p className="mt-8 mb-2 text-[19px] font-semibold">Every token that moves comes through one method:</p>
          <OnePath />

          <p><b>Twenty-three exported methods</b> in <code>contract/src/lib.rs</code>: <code>ft_on_transfer</code> (open · fund · fill), <code>storage_deposit</code>, <code>storage_withdraw</code>, <code>withdraw</code>, <code>cancel</code>, <code>reap</code>, <code>new</code>, <code>migrate</code>, two private payout callbacks, and thirteen views — <code>get_mandates</code>, <code>get_mandate</code>, <code>mandate_count</code>, <code>open_mandate_count</code>, <code>get_credit</code>, <code>storage_balance_of</code>, <code>storage_cost_estimate</code>, <code>is_signed</code>, <code>quote_signer</code>, <code>worst_cost</code>, <code>realised_cost</code>, <code>quote_age_secs</code>, <code>dry_check</code>. The views are the proof surface: every guarantee can be exercised with no key, no funds and no deposit.</p>
          <p><b>Two views deliberately do not check the signature.</b> <code>worst_cost</code> and <code>realised_cost</code> price whatever bytes they are handed — useful on a quote you are still deciding about — which is why <code>dry_check</code>, which does verify, is the one a filler consults before spending anything.</p>
          <p><b>Eight kinds of terms <code>open</code> refuses outright:</b> origin equal to destination; a destination that is not <code>nep141:</code>; a ceiling above 10,000 bps; a zero max fill; a zero age bound; an age bound over 30 days; an expiry already past; and a recipient other than the vault.</p>
          <p><b>What it costs to run.</b> A whole fill on mainnet: 30.48 TGas, every receipt counted — 10% of one transaction's limit. The verification itself: 7.8 TGas. Tests from a clean clone: 60 Rust (32 unit + 28 against a real sandbox node) plus 54 client assertions; no network, no key, no funds.</p>
          <p><b>The toolchain trap.</b> nearcore's VM only accepts MVP WebAssembly. From rustc 1.87 on the output is unusable — and <code>DeployContract</code> still succeeds, because deploying does not compile the module; every later call fails with <code>CompilationError(PrepareError(Deserialization))</code>. Hence near-sdk <code>=5.24.1</code>, near-sys <code>=0.2.9</code>, and a 1.86 wasm toolchain via <code>./build.sh</code>.</p>
        </>}>
        <div className="mx-auto max-w-[960px]"><FillFlow /></div>
      </Figure>

      {/* ------------------------------------------------------------ 2 · cost */}
      <Figure id="cost" no="2" title="The cost is the gap between what you paid and what arrived"
        takeaway={<>Both dollar figures are signed by the venue, so every hidden fee is already inside the gap — and it is measured on what <i>actually</i> arrived.</>}
        full={<>
          <Code>cost = 1 − (amountOutUsd × delivered ÷ amountOut) ÷ amountInUsd</Code>
          <p>Both USD marks are inside the signed payload, so the contract reads bytes it was handed and does integer arithmetic.</p>
          <p><b>Rounding has exactly one safe direction.</b> Every truncation must make the reported cost larger, never smaller — a bound that understates cost is not a bound. Four of the five steps round down, which pushes cost up; the last, <code>bps = shortfall / 1e9</code>, must round <i>up</i>, and was the one that needed fixing. On the honest fixture the exact cost is 159.348 bps; truncation reported 159, understating the bound. It now uses <code>div_ceil</code> and reports 160, pinned by <code>the_reported_cost_is_never_below_the_true_cost</code>.</p>
          <p><b>256-bit intermediates are not optional.</b> wNEAR has 24 decimals, so a $1M order is ~1e30 base units and delivered × 1e9 is ~1e39 — which overflows u128 (max ≈ 3.4e38). <code>mul_div</code> computes a·b as a 256-bit (hi, lo) pair and does restoring long division, 128 iterations.</p>
          <p><b>The quieter failure is in Exhibit A.</b> Honoured in full it still costs 503 bps, because 500 bps of <code>appFees</code> are already baked into the signed <code>amountOutUsd</code>. The contract cannot read <code>appFees</code> — it is not in the bytes being verified — and prices it to the basis point regardless.</p>
          <p className="mt-8 mb-2 text-[19px] font-semibold">Before that number is computed, a delivery passes nine gates. The first it fails names the clause it broke:</p>
          <Gauntlet />

          <p>The contract never serialises JSON. It is handed the exact bytes the client built, and does this:</p>
          <Code>{`sha256(bytes)
  → base58
  → ed25519_verify(sig, that string, signer)
  → from_slice(THE SAME bytes)`}</Code>
          <p>Hash first, parse second, same bytes both times. If a single byte differs from what the venue signed, verification fails before any field is read. <code>every_single_byte_is_covered_by_the_signature</code> asserts it by flipping each of the 692 bytes in turn.</p>
          <p><b>The signature is over the UTF-8 of the base58 string of the digest, not over the digest.</b> This is the single most load-bearing implementation detail in the project; getting it wrong produces a verifier that rejects every real quote.</p>
          <p>The canonicaliser exists several times, on purpose — <code>fixtures/mkfix.py</code> (Python + from-scratch ed25519), <code>client/src/lib/canonical.ts</code>, and this app's port, tested against the others on every build. All three agree, byte for byte and hash for hash, on all three fixtures.</p>
          <p>Re-serialising JSON inside a contract to re-derive a hash is a reliable way to lose a week: Rust and TypeScript must agree byte-for-byte on key order, number formatting and unicode escaping, forever. Hallmark has no canonicalisation code in Rust at all.</p>
          <p className="mt-8 mb-2 text-[19px] font-semibold">What the owner signs fits on one form:</p>
          <MandateForm />
          <p className="mt-8 mb-2 text-[19px] font-semibold">And each guarantee names the line of code that enforces it:</p>
          <InvariantWall items={INVARIANTS} />
          <p className="mt-8 mb-2 text-[19px] font-semibold">Whoever writes a byte pays for that byte — measured, never estimated:</p>
          <StorageBars />

          <p>NEAR stakes part of an account's balance per byte of state it holds, so somebody has to pay for a mandate's record. v1's answer was the vault, which gave a stranger about ten times leverage against it: roughly ten cents of gas and a live vault could no longer write state at all. v2 charged a fixed 1,536 bytes — also wrong, and its first version refunded more on cancel than it freed. v3 stops guessing: one helper runs at the end of every path that writes state, flushes the collections, diffs <code>env::storage_usage()</code>, and charges or credits exactly the difference.</p>
          <p><b>A trap inside the trap.</b> <code>near_sdk::store</code> collections buffer their writes and flush when the call ends, so <code>storage_usage()</code> immediately after a remove still reports the old figure — and the refund came out as zero. Hence the explicit flush.</p>
        </>}>
        <CostGauge />
      </Figure>

      {/* ----------------------------------------------------------- 3 · bound */}
      <Figure id="bound" no="3" title="Three fillers, one ceiling"
        takeaway={<>The same live quote, three independent strategies, all inside the owner's bound. The agreement does not care who fills it.</>}
        full={<>
          <p><code>bin/fill.ts</code> splits the spread and asks the contract for a verdict before spending anything. <code>fillers/edge.ts</code> fills only when its spread clears a floor it sets, and computes the cost itself — written from the specification alone, it exits non-zero if it ever disagrees with the contract. <code>fillers/adapted.ts</code> is the official NEAR Intents agent flow pointed at a vault: what a stranger's agent must change to become a filler.</p>
          <p><b>And the limit, stated.</b> First-come-first-served means whoever lands first wins, not whoever is cheapest. The owner gets their ceiling, not the best price in the market. The next version is a sealed-bid auction in which fillers commit to an amount and <i>only the winner delivers</i> — because the obvious auction, collecting deliveries and refunding the losers, would make the vault a custodian for the length of the window. Not claimed for v1.</p>
          <p><b>Why a stranger would bother.</b> The spread is the whole fee, so there is no fee field: the filler keeps the gap between what it sourced the output for and what it delivered, and that is already inside the owner's ceiling. For scale, 1Click's own rake is 20 bps. The capital requirement is real — inventory, or source-then-deliver carrying the price risk in between — and it is the price of closing the <code>depositAddress</code> hole. And every fill emits a receipt bound to the filler's account, so a filler accumulates a provable execution record rather than a self-reported one.</p>
          <p><b>What is not claimed.</b> There is no third-party filler ecosystem. Three fillers, all written by us or adapted by us.</p>
          <p className="mt-8 mb-2 text-[19px] font-semibold">Turning NEAR's own agent into a filler takes four changes:</p>
          <Redline />
          <p className="mt-8 mb-2 text-[19px] font-semibold">The bound also has a clock — and v1 got it wrong, on mainnet:</p>
          <HoleTimeline />

          <p>The bound is denominated in <code>amountInUsd</code> and <code>amountOutUsd</code>. Those numbers were true when the venue signed, and not necessarily now. v1's only freshness check was the quote's own deadline — and <code>deadline</code> is supplied by whoever requests the quote, which 1Click signs unquestioned. Measured live on 2026-11-01: deadlines of +1, +30, +365 and +3650 days were all signed.</p>
          <p>And <code>dry:true</code> quotes are free, unauthenticated, and still signed. So the attack cost nothing: ask for quotes matching an open mandate with deadlines years out, keep a library of them — free options on the owner's escrow, each struck at the prices of the day it was minted — and exercise whichever became profitable when the market moved. The owner's <code>max_cost_bps</code> was enforced exactly, against a market that no longer existed.</p>
          <p>The same keyless <code>dry_check</code>, same four arguments: against v1 on 2026-11-01, <code>ALLOWED at 60 bps</code>; against v2 on 2026-11-02, <code>REFUSED QuoteTooOld</code>. The fix was a field already inside the signature — <code>timestamp</code>, written by the venue — which v1 simply never read. <b>Being signed and being trustworthy are different properties.</b></p>
          <p><b>And a real transaction, not a simulation.</b> A quote was banked for 326 seconds against a 300-second bound, then a fill was broadcast with real USDT: <A href={`${EXPLORER}/txns/3JKAnmbAnQKM141iT3fd4Pk2jhTLjBmmYC3Gk4vp6Zyc`}>3JKAnmb…</A>. The vault refused it and the tokens came back. <b>A refused fill is a successful transaction</b> — NEP-141 catches the receiver's panic to make the refund work, so the outer status is <code>SuccessValue</code> and the refusal sits in an inner receipt. Anything reporting on a fill must read <code>receipts_outcome</code>.</p>
          <p><b>Why an audit found these, and reasoning did not.</b> The rounding bug (159 reported for 159.348), the storage bug twice (a fixed charge, then a refund larger than what was freed), and NEAR's own agent example returning HTTP 400 — every one found by running the code, not reading it.</p>
          <p className="mt-8 mb-2 text-[19px] font-semibold">Try it: how fresh do you insist on?</p>
          <FreshnessWidget />
        </>}>
        <RaceRuler />
      </Figure>

      <p className="mt-16 text-[19px]">
        <L to="/book">See the register and price a fill →</L> · <L to="/limits">What is still wrong with it →</L>
      </p>
    </main>
  );
}

const INVARIANTS: Array<[string, string]> = [
  ["No token is credited out unless the check passed", "the Err arm panics before either credit"],
  ["The reported cost is never below the true cost", "div_ceil on the final division"],
  ["The bytes hashed are the bytes parsed", "verify canonical, then from_slice(canonical)"],
  ["No unsigned field is ever read", "SignedQuote has no such field"],
  ["Verification makes no cross-contract calls", "Promises only in the payout methods"],
  ["The output arrives before the input is credited", "delivered is an ft_on_transfer argument"],
  ["Never more out than the escrow holds", "require!(amount_in <= escrow)"],
  ["Realised cost never exceeds the ceiling", "cost_bps > max_cost_bps refuses"],
  ["No admin function, no pause method", "there is no such method"],
  ["A failed payout restores the credit", "resolve_withdraw re-adds on Err"],
  ["No action with the wrong token", "asset id from the predecessor"],
  ["USD marks no older than the owner allows", "checked against the signed timestamp"],
  ["Nothing the counterparty chooses is a bound", "depositAddress unread; deadline not freshness"],
  ["The vault never pays for others' state", "every write ends in settle_storage"],
  ["Its storage is always prepaid", "reap refunds only measured bytes"],
  ["A signature is 64 bytes or refused", "decode_signature never zero-pads"],
];

/* --------------------------------------------- the freshness bound, live */

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
    placeholderData: (prev) => prev,
  });
  const c = verdict.data ? parseCheck(verdict.data) : null;
  const ageSecs = age.data ? Number(age.data) : null;

  return (
    <div className="sheet grid items-center gap-6 p-5 sm:grid-cols-[1fr_auto] sm:p-6">
      <div>
        <p className="text-[18px]">
          The honest capture was signed <b className="typed">{ageSecs !== null ? `${(ageSecs / 86_400).toFixed(1)} days` : "…"}</b> ago.
          Refuse quotes older than <b className="typed text-sign">{AGES[i][1]}</b>:
        </p>
        <input type="range" min={0} max={AGES.length - 1} step={1} value={i} onChange={(e) => setI(Number(e.target.value))}
          className="mt-4 w-full accent-[var(--ink)]" aria-label="max quote age" />
        <div className="typed mt-1 flex justify-between text-[12px] text-faint">{AGES.map(([, l]) => <span key={l}>{l}</span>)}</div>
        <Entry k="dry_check, verbatim" v={<code className={cn("break-all text-[12.5px]", c?.allowed ? "text-sign" : "text-seal")}>{verdict.data ?? "…"}</code>} />
        <p className="typed mt-2 text-[12.5px] text-faint">↳ {VAULT}, ceiling 300 bps, delivering amountOut. Validly signed at every point on this scale; only its age is tested.</p>
      </div>
      <div className="flex justify-center">
        {c && (c.allowed
          ? <Seal key={`ok${i}`} slam ink="blue" top="honoured" big={`${c.costBps}`} bottom="bps" size={150} />
          : <Seal key={`no${i}`} slam top="refused" big={refusalOf(c.reason).clause} bottom={refusalOf(c.reason).words} size={150} />)}
      </div>
    </div>
  );
}
