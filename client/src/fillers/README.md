# Four fillers

A mandate is only worth something if a stranger can fill it. These are four
fillers written to find out, and they are deliberately not four copies of each
other.

| | strategy | written from | why it exists |
|---|---|---|---|
| `../bin/fill.ts` | splits the spread: delivers halfway between the venue's floor and its expected fill | the architecture, by us | the reference. Asks the contract for a verdict before spending |
| `edge.ts` | **patient**: only fills when the spread it keeps clears a floor it sets itself, and it computes the cost itself rather than asking the contract | `ARCHITECTURE.md` §2.1 and §5.3 alone, without reading `fill.ts` | an independent implementation of the invariant. If it agrees with the contract on live quotes, the spec is implementable by somebody who was not in the room |
| `adapted.ts` | the official NEAR Intents agent flow, pointed at a vault | `near/agent-skills`, skill `near-intents`, `rules/server-example.md` | shows what a stranger's agent has to change to become a filler. The diff is the claim |
| `sourced.ts` | **holds nothing on NEAR**: buys the exact output it is short on another chain, waits for it to land, re-prices, then delivers | the architecture, by us | that the bound and the liquidity need not live on the same chain. Run on mainnet both ways — out of Base, and end to end holding zero wNEAR |

```bash
npm run fill            # the reference, dry by default without a key
npm run fill:edge       # the independent one
npm run fill:adapted    # the adapted official agent
npm run fill:sourced    # the one that holds nothing on NEAR
npm run race            # three of them price the same mandate, side by side
```
