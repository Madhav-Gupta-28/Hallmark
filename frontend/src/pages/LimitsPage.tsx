/**
 * Exclusions & limitations — ported from web/limits.html ("the most credible
 * page on this site"). The text is the reference's, with one passage rewritten
 * to describe this app rather than the static site: the wallet library is
 * bundled from npm here, not fetched from a CDN.
 */
import type { ReactNode } from "react";
import { Clause, Heading, L, Seal, Stamp } from "@/components/doc";
import { cn } from "@/lib/utils";

const P = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("my-3 max-w-[800px] text-[18.5px] leading-[1.55]", className)}>{children}</p>
);

export function LimitsPage() {
  return (
    <main className="doc">
      <section className="relative pt-10">
        <div className="label text-faint">Schedule D · the most credible page in this register</div>
        <h1 className="mt-3 font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
          Exclusions <span className="font-medium italic">&amp;</span> limitations.
        </h1>
        <P className="mt-5 text-[20px]">
          Every limit below is in the specification, and they are collected here rather than buried at the bottom of a
          document nobody opens. One of them is not fixable from inside the design, and it is stated rather than managed.
        </P>
        <div className="pointer-events-none absolute right-0 top-16 hidden lg:block">
          <Seal top="read this" big="§D" bottom="before signing" size={160} tilt={11} />
        </div>
      </section>

      <Heading kicker="Part I">Not claimed</Heading>
      <Clause no="D.1" title="Not best execution">
        Hallmark proves a bound and enforces a realised cost, not optimality. With one filler and first-come-first-served,
        the filler delivers near the floor and keeps the spread: the owner gets their ceiling, not the best price in the
        market. An auction window — collect deliveries for N blocks, settle the best — is the natural next version and is
        not a v1 claim.
      </Clause>
      <Clause no="D.2" title="Not an independent price benchmark">
        Killed by measurement, and it was the more compelling story. All 8,992 Rhea pools were scanned: 31 contain
        Intents-USDC, and zero contain Intents-USDC and wNEAR together. The cause is asset fragmentation — Intents uses
        omni-bridge tokens while Rhea's liquidity sits in factory.bridge.near wrappers and native tokens. Same tickers,
        different assets. This is why the signed USD marks are the right reference: there is no on-chain alternative.
      </Clause>
      <Clause no="D.3" title="Not a reputation or counterparty-scoring system">
        No account-age heuristics, no blocklists, no contract-change detection. Six public NEAR repositories already do
        that, and all six pass the 99.99% quote.
      </Clause>
      <Clause no="D.4" title="Not a custodian, ever">
        The output is in the vault before the input is credited to anybody, and payouts are pull rather than push. No
        design that involved holding a counterparty's funds survived review — there are eleven of them in the design ledger.
      </Clause>

      <Heading kicker="Part II">The honest hole</Heading>
      <div className="grid items-start gap-8 md:grid-cols-[1fr_auto]">
        <div>
          <h3 className="font-serif text-[26px] font-bold">If 1Click's signing key is stolen, the cryptography is gone.</h3>
          <P>
            An attacker could mint quotes with any terms, and Hallmark would accept any that fit the ceiling. The guarantee
            degrades from cryptographic to the ceiling the owner signed — which still caps the loss at{" "}
            <code>max_cost_bps</code> of <code>max_fill</code> per fill rather than the whole escrow, but the crypto is gone.
          </P>
          <P><span className="hl">This is not fixable from inside the design.</span> It is stated rather than buried.</P>
          <P>
            The weakest assumption the project is willing to make is the neighbouring one: that 1Click's signed{" "}
            <code>amountInUsd</code> and <code>amountOutUsd</code> marks are honest. The whole bound is denominated in
            them. If the venue marks dishonestly, the bound is wrong — but it is their own signature, which is why this
            is the weakest link we accept and why it is worth accepting.
          </P>
        </div>
        <Seal top="unmitigated" big="!" bottom="signer key theft" size={150} tilt={-8} className="mx-auto" />
      </div>

      <Heading kicker="Part III">The threat model, in full</Heading>
      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="ledger min-w-[760px] text-[16.5px]">
          <thead><tr><th>adversary</th><th>capability</th><th>outcome</th></tr></thead>
          <tbody>
            {([
              ["a prompt-injected agent of the owner's own", "can deliver against any quote it can obtain", "bounded by the ceiling — the primary case", "blue"],
              ["a malicious filler", "any slippageTolerance, any appFees, any route", "worst.quote.json is this, and it is refused", "blue"],
              ["a filler nominating its own deposit address", "—", "impossible — the vault never sends to one", "blue"],
              ["a filler claiming another's delivery", "—", "impossible — the amount is a function argument, not a balance delta", "blue"],
              ["a filler banking free signed quotes as options", "1Click signs a 10-year deadline for nothing", "closed — v1 was exposed to this", "blue"],
              ["a griefer buying the vault's storage with gas", "~10 cents to stop every write", "closed — whoever writes a byte pays for it", "blue"],
              ["a malicious filler with a stolen agent key", "unlimited delivery attempts", "each bounded; worst case is repeated ceiling-cost fills, capped by max_fill and escrow", "blue"],
              ["1Click, signing a terrible quote", "—", "refused — its own signature is the evidence", "blue"],
              ["1Click, refusing to sign", "—", "liveness loss, never a funds loss", "blue"],
              ["1Click's signer key compromised", "can mint arbitrarily bad signed quotes", "unmitigated", "red"],
              ["us, the deployer", "no admin function, no pause; the upgrade key is still held", "nobody to switch it off — once the key is deleted (Part V)", "red"],
            ] as const).map(([a, c, o, ink]) => (
              <tr key={a}>
                <td className="font-semibold">{a}</td>
                <td>{c}</td>
                <td>{ink === "red" ? <Stamp tilt={0}>{o}</Stamp> : o}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Heading kicker="Part IV">Known limits, numbered</Heading>
      <Clause no="1" title="One sub-cent transfer is not attributed">
        A fill charges the filler for the owner's credit slot, and the owner is credited ~0.00145 NEAR for releasing it.
        Never a loss to the vault, and it cannot be farmed, because every such transfer requires a real delivery that
        costs the filler far more than that.
      </Clause>
      <Clause no="2" title="First-come-first-served means the filler delivers near the floor">See D.1.</Clause>
      <Clause no="3" title="1Click signer-key compromise is unmitigated">See Part II.</Clause>
      <Clause no="4" title="No independent price benchmark exists">A bound, never best execution.</Clause>
      <Clause no="5" title="Liveness depends on 1Click">
        If the API stops signing, Hallmark stops filling. It never stops refusing, which is the safe direction.{" "}
        <i>Observed, not theorised:</i> on 2026-11-02 the API returned HTTP 521 for an extended period, then partially
        recovered — serving <code>/v0/tokens</code> while refusing every quote. During the outage no fill was possible and
        every keyless view kept answering. It also found a gap: posting a mandate, which needs nothing from the venue,
        failed with the outage because resolving a ticker went through <code>/v0/tokens</code>. Fixed — and the live
        mandate was posted during the outage to prove it.
      </Clause>
      <Clause no="6" title="The filler needs capital">
        It must front the output. This is the deliberate cost of closing the <code>depositAddress</code> hole, and it is
        what a dealer does.
      </Clause>
      <Clause no="7" title="Three fillers, all written by us or adapted by us">
        There is no third-party filler ecosystem and none is claimed.
      </Clause>
      <Clause no="8" title="Immutable means unpatchable">
        Once the full-access key is deleted, a bug found later cannot be patched — only superseded by a new deployment
        that owners migrate to voluntarily.
      </Clause>
      <Clause no="9" title="Mainnet only">
        No Intents testnet exists or is planned. Dev accounts, tiny amounts, <code>dry:true</code> quotes wherever possible.
      </Clause>
      <Clause no="10" title="Signing in the browser needs a wallet library, and that is third-party code">
        Reading needs nothing: the register, the test of compliance, verifying a quote and any account's statement are
        keyless view calls. But a NEAR function-call key may only sign calls to one contract with a zero deposit, while
        drawing up an agreement needs a deposit on the vault and one yoctoNEAR on the token — so no key a web page could
        hold would work, and signing needs a full-access signature. This app therefore bundles{" "}
        <code>@near-wallet-selector</code> 8.10.2 from npm, pinned exactly, and loads it only once you connect or already
        have a session. The mitigation is the same code path: every execution page renders the exact transaction and the
        exact <code>near</code> command from the same objects the wallet is handed, so the command you copy cannot drift
        from what the button sends, and every action stays possible with no wallet at all. A rival connector was rejected outright because its wallet manifest resolved to one individual's personal GitHub repository.
      </Clause>

      <Heading kicker="Part V">Immutability is a deployment step, not a sentence</Heading>
      <P>
        “Nobody to switch it off” is only true once it is executed. After the final deploy the full-access key gets
        deleted, so the contract cannot be upgraded or paused by anyone, including us. Two costs, both accepted and both
        stated:
      </P>
      <Clause no="(a)" title="A bug found later cannot be patched">Only superseded.</Clause>
      <Clause no="(b)" title="The storage lock becomes permanent">
        An account with no full-access key cannot be deleted, and deleting the account is the only way to release the
        NEAR staked against the contract's code — 2.76 NEAR for this contract. Immutability and recoverability are the
        same key; you cannot keep both.
      </Clause>
      <P>
        <span className="hl">The key still exists, deliberately.</span> This project found a critical bug in a contract
        that was already live, twice — and fixed both by redeploying. Had the key been gone, neither could have been
        fixed. Because the cost is identical whenever it is paid, the key is deleted last, after the hackathon's winners
        are announced.
      </P>

      <Heading kicker="Part VI">What success looks like, honestly</Heading>
      <h3 className="font-serif text-[26px] font-bold">Not a billion-dollar company — a product with real usage.</h3>
      <P>
        The near-term test is whether anyone delegates a real order to a mandate they did not write, and whether a filler
        they do not know fills it inside the bound. That is a small number of people doing a real thing, and it is the
        only number worth watching first.
      </P>
      <P>
        The larger shape, stated as a thesis and not a projection: if delegated machine execution becomes ordinary,
        something has to bound it, and the thing that bounds it is positioned to become the standard rather than an
        implementation. FINRA asking about safe harbors is the tell. Revenue, at 1Click's own 20 bps anchor against $4.80B a month of settled Intents volume, is a
        real business long before it is a large one. We are not claiming the large one.
      </P>

      <p className="mt-14 text-[19px]"><L to="/how">How the clauses are enforced →</L> · <L to="/">Back to the agreement</L></p>
    </main>
  );
}
