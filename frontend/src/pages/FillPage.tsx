/**
 * The filler's door.
 *
 * The register is open to anyone, and the site said so everywhere while giving
 * a would-be filler nowhere to start: the one artefact that makes it concrete —
 * NEAR's own Intents agent, turned into a filler in four changes — was folded
 * inside a figure on /how. This page is that artefact, plus what there is to
 * earn, plus the agreements open right now, in the order a stranger needs them.
 */
import { useQuery } from "@tanstack/react-query";
import { A, Entry, Heading, L, Source } from "@/components/doc";
import { Figure } from "@/components/figure";
import { EXPLORER, units, VAULT } from "@/lib/hallmark";
import { bookQuery, tokensQuery } from "@/lib/queries";
import { meta } from "@/lib/tokens";
import { RaceRuler, Redline } from "./how/figures";

const REPO = "https://github.com/Madhav-Gupta-28/Hallmark";

export function FillPage() {
  return (
    <main className="doc">
      <section className="pt-10">
        <div className="label text-faint">For anyone who wants to be on the other side</div>
        <h1 className="mt-3 max-w-[18ch] font-serif text-[clamp(34px,5.4vw,68px)] font-extrabold leading-[0.97] tracking-[-0.02em]">
          Anyone may fill. <span className="hl">Including you.</span>
        </h1>
        <p className="mt-6 max-w-[58ch] text-[21px] leading-[1.45]">
          Deliver what an agreement asks for and the escrow is yours. Nobody grants permission — the contract
          reads what arrived, not who sent it.
        </p>
      </section>

      <Open />

      <Figure id="earn" no="1" title="What there is to earn"
        takeaway={<>The spread <i>is</i> the fee: you keep the gap between what the output cost you and what you delivered.</>}
        full={<>
          <p>There is no fee field and no rake, because there is nothing to take one from: the owner's ceiling
            is the only number, and anything you do not spend sourcing the output is yours. For scale, 1Click's
            own rake on the same flow is 20 bps.</p>
          <p><b>The capital requirement is real, and it is the price of a hole being closed.</b> You deliver
            first, so you need destination-asset inventory, or you source it and carry the price risk in
            between. That is what a dealer does. The alternative — paying the filler first — is the design that
            could simply be robbed, because the quote's deposit address is not signed.</p>
          <p><b>And a limit, stated.</b> First come, first served: whoever lands first wins, not whoever is
            cheapest. A sealed-bid version where only the winner delivers is the documented next step.</p>
          <p>Every fill also emits a receipt bound to your account, so a filler accumulates a provable
            execution record rather than a self-reported one.</p>
        </>}>
        <RaceRuler />
      </Figure>

      <Figure id="agent" no="2" title="Your agent becomes a filler in four changes"
        takeaway={<>This is NEAR's own Intents agent example, marked up. Nothing else about it changes — same API, same quote request, same fields. Only the direction of trust.</>}
        full={<>
          <p>The four fillers in the repository are the same four changes applied four ways:
            <code> bin/fill.ts</code> splits the spread and asks the contract for a verdict before spending
            anything; <code>fillers/edge.ts</code> fills only when its spread clears a floor it sets, and
            computes the cost itself from the specification alone, exiting non-zero if it ever disagrees with
            the chain; <code>fillers/adapted.ts</code> is the official agent flow pointed at a vault; and
            <code>fillers/sourced.ts</code> holds nothing on NEAR at all — it buys the output on another
            chain and delivers that, which it has done on mainnet in both directions.</p>
          <p>There is a fifth, and it is written to <i>lose</i>: <code>bin/breach.ts</code> deliberately
            does not run our guard, because the only way to show the <i>contract</i> refusing — rather than
            our client politely declining — is to send it a fill it should refuse.</p>
          <p><b>What is not claimed:</b> there is no third-party filler ecosystem yet. Four fillers, all
            written or adapted by us. You would be the fifth, and the first we did not write.</p>
        </>}>
        <Redline />
      </Figure>

      <section className="mt-20">
        <Heading kicker="Run it">Three commands, no key until the last one</Heading>
        <pre className="sheet my-6 overflow-x-auto px-5 py-4 text-[13.5px] leading-relaxed">{`git clone ${REPO} && cd Hallmark/client && npm install

npm run bound      # what a live quote actually guarantees — no key, no funds
npm run race       # three fillers price the same mandate, no key, no funds

export NEAR_ACCOUNT=you.near                 # a key is needed only here
npm run fill       # deliver against an open agreement, and be credited`}</pre>
        <p className="max-w-[62ch] text-[19px]">
          The first two spend nothing and need nobody's permission — they are the same keyless view calls every
          figure on this site is read from. Only <code>fill</code> moves a token, and before it does it asks{" "}
          <code>dry_check</code> what the contract would rule, so it never spends on a delivery that will be
          refused.
        </p>
        <Source>
          <A href={`${REPO}/blob/main/client/src/fillers/adapted.ts`}>adapted.ts</A> ·{" "}
          <A href={`${REPO}/blob/main/client/src/fillers/edge.ts`}>edge.ts</A> ·{" "}
          <A href={`${REPO}#5-watch-three-different-agents-price-the-same-mandate`}>the README</A>
        </Source>
      </section>

      <p className="mt-16 text-[19px]">
        <L to="/book">See what is open →</L> · <L to="/how">How the clauses are enforced →</L> ·{" "}
        <L to="/limits">What is still wrong with it →</L>
      </p>
    </main>
  );
}

/** The agreements a filler could take right now, read from the chain. */
function Open() {
  const book = useQuery(bookQuery);
  const tokens = useQuery(tokensQuery);
  const table = tokens.data ?? {};
  const open = (book.data ?? []).filter(([, m]) => m.open);

  return (
    <section className="mt-12">
      <p className="label mb-2">Open right now</p>
      {book.isPending && <p className="typed text-[15px] text-faint">reading the register…</p>}
      {book.isSuccess && open.length === 0 && (
        <p className="text-[19px]">Nothing is open at this moment. <L to="/post">Draw one up</L> and fill your own.</p>
      )}
      {open.map(([id, m]) => {
        const inTok = meta(table, m.terms.origin_asset);
        const outTok = meta(table, m.terms.destination_asset);
        return (
          <Entry key={id} k={`§${id} · ${inTok.symbol} → ${outTok.symbol}`} v={
            <L to={`/mandate/${id}`} className="typed">
              {inTok.dp === null ? `${m.escrow} base units` : `${units(m.escrow, inTok.dp, 6)} ${inTok.symbol}`}
              {" "}escrowed · {m.terms.max_cost_bps} bps ceiling →
            </L>
          } />
        );
      })}
      <Source>get_mandates on <A href={`${EXPLORER}/address/${VAULT}`}>{VAULT}</A>, keyless, re-read every 30 s.</Source>
    </section>
  );
}
