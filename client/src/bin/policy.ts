/**
 * What a spend-policy guard can actually see, and why it is not enough.
 *
 *   npm run policy
 *
 * §3.16 says every agent-guard repository on NEAR implements the same shape —
 * recipient allowlist, per-transaction cap, daily cap, method allowlist — and
 * that all of them approve `worst.quote.json`. That was asserted and not
 * runnable, which in this repository is a defect. This makes it runnable.
 *
 * Nobody else's code is executed or quoted here. What is implemented below is
 * the *shape*, written out plainly, and the point does not depend on any
 * particular implementation of it — it depends on where the loss lives.
 *
 * The loss is not in the transaction. An agent swapping through 1Click signs
 * `ft_transfer_call` of the origin asset to a deposit address. `amountOut`,
 * `minAmountOut`, `amountOutUsd` and `appFees` are in the *quote*, which is
 * off-chain and is not an argument to that call. A guard inspecting the
 * transaction is not being careless when it misses a 99.99% loss. It is
 * looking at a thing the loss is not in.
 *
 * No key, no funds, no network.
 */
import { readFileSync } from "node:fs";
import { worstCostBps, costBps } from "../lib/canonical.ts";

const repo = new URL("../../../", import.meta.url).pathname;
const load = (n: string) => JSON.parse(readFileSync(`${repo}fixtures/${n}.quote.json`, "utf8"));

/* ------------------------------------------------- the shape, written out */

interface Policy {
  allowedRecipients: string[];
  maxPerTxUsd: number;
  maxPerDayUsd: number;
  allowedMethods: string[];
}

/** The transaction an agent actually signs to swap through 1Click. */
interface AgentTx {
  method: string;
  receiver: string;      // the token contract
  to: string;            // who the tokens go to
  amountUsd: number;     // what leaves the account
}

const POLICY: Policy = {
  allowedRecipients: ["intents.near", "1click.near", "demo.near"],
  maxPerTxUsd: 100,
  maxPerDayUsd: 1_000,
  allowedMethods: ["ft_transfer_call"],
};

function check(p: Policy, tx: AgentTx, spentTodayUsd: number): string[] {
  const refusals: string[] = [];
  if (!p.allowedMethods.includes(tx.method)) refusals.push(`method ${tx.method} not allowed`);
  if (!p.allowedRecipients.includes(tx.to)) refusals.push(`recipient ${tx.to} not on the allowlist`);
  if (tx.amountUsd > p.maxPerTxUsd) refusals.push(`$${tx.amountUsd} over the $${p.maxPerTxUsd} per-transaction cap`);
  if (spentTodayUsd + tx.amountUsd > p.maxPerDayUsd) refusals.push(`over the $${p.maxPerDayUsd} daily cap`);
  return refusals;
}

/* ----------------------------------------------------------------- the run */

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`
  A spend-policy guard, and a quote that loses 99.99%
  ${"─".repeat(68)}
  policy: methods ${POLICY.allowedMethods.join(", ")} · recipients ${POLICY.allowedRecipients.length} allowed
          $${POLICY.maxPerTxUsd}/tx · $${POLICY.maxPerDayUsd}/day
`);

for (const name of ["honest", "worst"] as const) {
  const res = load(name);
  const q = res.quote;
  const inUsd = Number(q.amountInUsd);

  // The transaction is identical in shape for both quotes: send the origin
  // asset to the venue. Nothing about the output appears in it.
  const tx: AgentTx = {
    method: "ft_transfer_call",
    receiver: res.quoteRequest.originAsset,
    to: "intents.near",
    amountUsd: inUsd,
  };

  const refusals = check(POLICY, tx, 0);
  const guard = refusals.length ? `REFUSED — ${refusals[0]}` : "APPROVED";
  const worst = worstCostBps(res);
  const full = costBps(res, BigInt(q.amountOut));
  const fees = (res.quoteRequest.appFees ?? []) as Array<{ recipient: string; fee: number }>;

  console.log(`  ${pad(name + ".quote.json", 20)} the agent signs: ${tx.method}, $${inUsd.toFixed(2)} → ${tx.to}`);
  console.log(`  ${pad("", 20)} the guard says: ${guard}`);
  console.log(`  ${pad("", 20)} slippageTolerance it would read, if it could: ${res.quoteRequest.slippageTolerance} bps`);
  console.log(`  ${pad("", 20)} appFees, unsigned and unreadable: ${fees.length ? fees.map((f) => `${f.fee}bps→${f.recipient}`).join(", ") : "none"}`);
  console.log(`  ${pad("", 20)} ACTUAL guaranteed-worst all-in cost: ${worst} bps   (at full fill: ${full} bps)`);
  console.log();
}

console.log(`  ${"─".repeat(68)}
  Both transactions are the same size, to the same place, by the same method,
  so the same policy answers the same way. The difference between them is
  entirely in the quote — and the quote is not an argument to the call the
  guard inspects.

  Note the honest fixture especially. Its slippageTolerance reads 100 bps.
  Its guaranteed-worst all-in cost is higher than that. Handing the guard the
  quote would not fix this: the field it would reach for understates the number
  that matters, because slippage is not the only thing between amountOut and
  minAmountOut.

  Hallmark checks what ARRIVED, against the four USD figures the venue signed.
  That is the whole difference, and it is why the ceiling is a number rather
  than a list of things to forbid.
`);
