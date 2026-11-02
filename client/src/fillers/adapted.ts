/**
 * NEAR's own official Intents agent, turned into a Hallmark filler.
 *
 * The starting point is `near/agent-skills`, skill `near-intents`,
 * `rules/server-example.md` — the file NEAR ships for an agent that needs to do
 * a swap from a script. Install it the way an agent would:
 *
 *     npx skills add near/agent-skills --skill near-intents
 *
 * That example's flow, verbatim from the skill:
 *
 *     fetchTokens -> getQuote(dry:false) -> send deposit to quote.depositAddress
 *                 -> submitDeposit(txHash, depositAddress) -> pollStatus until terminal
 *
 * Below is that same flow with four changes, and nothing else. They are marked
 * [1]..[4] in the code, and ARCHITECTURE.md §6.2 carries the same list.
 *
 *   [1] WHERE THE WORK COMES FROM. The official agent is told what to swap. A
 *       filler reads `get_mandates()` off the vault — a keyless view call — and
 *       the mandate names the pair, the size and the ceiling it must beat.
 *
 *   [2] WHO THE OUTPUT IS FOR. `recipient` becomes the *vault*, not the agent.
 *       This is what lets the contract match the quote to the mandate at all:
 *       `recipient` is inside the signature, so a quote addressed elsewhere is
 *       refused with `WrongRecipient`.
 *
 *   [3] THE DEPOSIT STEP IS INVERTED — the load-bearing change. The official
 *       agent sends the *origin* asset to `quote.depositAddress` and waits for
 *       1Click to deliver. A filler sends the *destination* asset to the vault,
 *       with the signed quote in `msg`, and is credited the origin asset in the
 *       same transaction. `depositAddress` is never used, because it is not
 *       covered by the venue's signature (§2.4) — so a filler does not need to
 *       trust it, and the vault must not.
 *
 *   [4] NO POLLING. `submitDeposit` and `pollStatus` disappear. The official
 *       flow is asynchronous and ends in `SUCCESS | FAILED | REFUNDED`; a fill
 *       is settled synchronously inside `ft_on_transfer`, so the terminal state
 *       is the transaction receipt. Note the trap: a *refused* fill is a
 *       SUCCESSFUL `ft_transfer_call` whose inner receipt failed, because
 *       NEP-141 catches the panic to make the refund work.
 *
 * What is unchanged: the API base, the quote request shape, `slippageTolerance`,
 * the asset ids coming from `/v0/tokens`, and the discipline of reading
 * `amountOut` / `minAmountOut` off a signed quote. An agent that already speaks
 * 1Click keeps all of that.
 *
 *   HALLMARK_ACCOUNT=filler.near HALLMARK_KEY=ed25519:... npm run fill:adapted
 *   npm run fill:adapted -- --dry
 */
import { canonicalise, costBps, quoteAgeSecs, signatureB58, verifySigner } from "../lib/canonical.ts";
import { Hallmark, receiptFailure, signer, transferCall, tokenAccount } from "../lib/hallmark.ts";

// ============================================================ CONFIG
// As the skill has it.
const API_BASE = "https://1click.chaindefuser.com";
const API_KEY = process.env.ONE_CLICK_API_KEY; // optional; the skill notes a fee without one

// Added: the vault the mandates live on.
const VAULT = process.env.HALLMARK_VAULT ?? "hallmarkfi.near";
const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org";
const DRY = process.argv.includes("--dry") || !process.env.HALLMARK_KEY;

// ============================================================ API FUNCTIONS
// Straight from `rules/server-example.md`, minus the `dry: false` default.

interface Token {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
}

async function fetchTokens(): Promise<Token[]> {
  // The skill's version omits a User-Agent; a plain script gets HTTP 403
  // without one, which reads like an auth failure and is not (§3.4).
  const res = await fetch(`${API_BASE}/v0/tokens`, { headers: { "User-Agent": "hallmark/0.1" } });
  if (!res.ok) throw new Error("Failed to fetch tokens");
  return res.json();
}

/**
 * `[0]` — a correction to the official example, before any Hallmark change.
 *
 * `rules/server-example.md`'s `getQuote` sends only `dry`, `swapType`,
 * `slippageTolerance` and the five params below. Run verbatim against the live
 * API on 2026-11-02 that is **HTTP 400**:
 *
 *   depositType should not be empty … refundType should not be empty …
 *   recipientType should not be empty … deadline must be a valid ISO 8601 date
 *
 * `rules/api-quote.md` lists all four with defaults (`ORIGIN_CHAIN`,
 * `DESTINATION_CHAIN`, `ORIGIN_CHAIN`, `~10min`), so the example omits them —
 * but the network requires them. Documentation disagreeing with the network is
 * the thing ARCHITECTURE.md §0 is about, and the network wins. They are sent
 * explicitly here.
 */
async function getQuote(params: {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
}) {
  const res = await fetch(`${API_BASE}/v0/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "hallmark/0.1",
      ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
    },
    body: JSON.stringify({
      // [3] `dry: true`, not `dry: false`. The official agent needs a deposit
      // address; a filler never touches one, so it never needs a wet quote.
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      // [0] required by the API, documented as optional. See above.
      depositType: "ORIGIN_CHAIN",
      refundType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 36e5).toISOString(),
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`Quote failed: ${await res.text()}`);
  return res.json();
}

// ============================================================ FILL EXECUTION
// This is `executeSwap` from the skill, with [1]..[4] applied.

async function main() {
  const tokens = await fetchTokens();
  const onNear = new Map(tokens.filter((t) => t.blockchain === "near").map((t) => [t.assetId, t]));

  // [1] the work comes from the chain, not from an instruction
  const hallmark = new Hallmark(VAULT, RPC);
  const mandates = await hallmark.openMandates();
  console.log(
    `\n  adapted official agent — ${mandates.length} open mandate(s) on ${VAULT}` +
      `${DRY ? "   [dry run]" : ""}\n`,
  );

  for (const [id, m] of mandates) {
    const from = onNear.get(m.terms.origin_asset);
    const to = onNear.get(m.terms.destination_asset);
    const label = `  #${id} ${from?.symbol ?? "?"} -> ${to?.symbol ?? "?"}`;
    if (!from || !to) {
      console.log(`${label}  skip: not a NEAR-settled pair this agent can hold`);
      continue;
    }

    const amountIn =
      BigInt(m.escrow) < BigInt(m.terms.max_fill) ? BigInt(m.escrow) : BigInt(m.terms.max_fill);
    if (amountIn === 0n) {
      console.log(`${label}  nothing left to fill`);
      continue;
    }

    const res = await getQuote({
      originAsset: from.assetId,
      destinationAsset: to.assetId,
      amount: amountIn.toString(),
      // [2] the output is for the vault, and `recipient` is signed
      recipient: m.terms.recipient,
      refundTo: m.terms.recipient,
    });

    const canonical = canonicalise(res);
    if (!verifySigner(canonical, res.signature)) {
      console.log(`${label}  REFUSING to act: the quote does not verify`);
      continue;
    }
    const age = quoteAgeSecs(res);
    if (age > m.terms.max_quote_age_secs) {
      console.log(`${label}  skip: quote is ${age}s old, mandate allows ${m.terms.max_quote_age_secs}s`);
      continue;
    }

    // This agent delivers the venue's expected fill — the most generous of the
    // three, and the cheapest for the owner. It keeps whatever it can source
    // the output for below that.
    const deliver = BigInt(res.quote.amountOut as string);
    const cost = costBps(res, deliver);
    const human = (v: bigint, d: number) => (Number(v) / 10 ** d).toFixed(6);
    console.log(
      `${label}  deliver ${human(deliver, to.decimals)} ${to.symbol}` +
        `  -> ${cost} bps vs a ${m.terms.max_cost_bps} bps ceiling  (quote ${age}s old)`,
    );
    if (cost > m.terms.max_cost_bps) {
      console.log(`       pass: the ceiling refuses this`);
      continue;
    }
    if (DRY) continue;

    // [3] the deposit, inverted: the DESTINATION asset into the vault, with the
    // signed quote attached. No depositAddress anywhere.
    const account = signer(process.env.HALLMARK_ACCOUNT!, process.env.HALLMARK_KEY!, RPC);
    const out = await transferCall(account, tokenAccount(to.assetId), VAULT, deliver.toString(), {
      action: "fill",
      mandate_id: id,
      canonical,
      signature: signatureB58(res),
    });

    // [4] no polling. The receipt is the terminal state — and a refused fill is
    // a successful transaction, so the inner receipts are where the truth is.
    const refused = receiptFailure(out);
    console.log(refused ? `       REFUSED: ${refused}` : `       filled:  ${out.transaction.hash}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(`\n  ${e?.message ?? e}\n`);
  process.exit(1);
});
