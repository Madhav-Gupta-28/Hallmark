<picture>
  <source media="(prefers-color-scheme: dark)" srcset="frontend/public/logo-paper.svg">
  <img alt="Hallmark" src="frontend/public/logo-ink.svg" width="56" height="56">
</picture>

# Hallmark

**A not-held order that enforces its own execution bound.**

> **Live on NEAR mainnet: [`hallmarkfi.near`](https://nearblocks.io/address/hallmarkfi.near)**

On 31 October 2026 NEAR Intents signed a quote offering **$10 → 2.1437 wNEAR**.
The amount that quote *guarantees* is **0.00021437 wNEAR** — one ten-thousandth
of it. Both numbers sit in the same signed payload, both are true, and the
venue really signed them. The capture is `fixtures/worst.quote.json`; §1
re-verifies the signature from a clean clone and §2 asks the live contract,
with no key, what that floor costs. It answers **10000 bps**.

That is the gap an agent trades through, and it is a bound, not a bug: the
venue promised the floor and offered the rest. Hallmark makes you name what
you will actually accept, and refuses the rest on your behalf.

A not-held order hands discretion over the time and price of your trade to
somebody else. For a century the only thing protecting the client was a promise —
the best execution obligation. NEAR Intents signs the economics of every fill, so
on NEAR that promise can be a number instead.

An owner funds a mandate: a pair, a worst acceptable all-in cost, a maximum
fill, a maximum quote age, an expiry. Anyone may fill it. The filler delivers
the output first, and the contract verifies that delivery against NEAR Intents'
own signature before the filler is credited with the input.

No oracle. No price feed. No custodian. No admin key.

```
cost = 1 − (amountOutUsd × delivered / amountOut) / amountInUsd
```

Four signed fields and the amount that actually arrived. Slippage, bridge fee,
solver spread and any app fee have all already moved those numbers before the
venue signed them, so there is nothing else to enumerate.

## Where NEAR Intents fits, and where it does not

Hallmark uses exactly one thing from NEAR Intents: **the signature over a
quote.** `amountIn`, `amountOut`, `minAmountOut` and the two USD marks are
signed by the venue, so the owner's ceiling can be checked against numbers the
venue committed to rather than against anything a filler says. It is a
read-only artifact, verified on-chain by `ed25519_verify`.

What Hallmark never uses is Intents holding, routing or releasing a balance for
it. The vault sends nothing to any address a counterparty nominated — the hole
that makes that unsafe is `depositAddress` being outside the signature (§2.4),
and the same class of fault is what cost NEAR Intents ~$3.8M on 1 October 2026
in its Omni deposit layer. Hallmark depends on the part that held, not the part
that did not.

**Both legs of a mandate settle on NEAR** — the contract requires `nep141:`
assets on both sides, and a mandate that *paid out* to another chain would mean
the vault sending to an address a counterparty named, which is the one thing
§2.4 exists to refuse.

**Where a chain gets crossed is the fill, and that is the filler's side.** The
vault only ever sees a NEAR token arrive; where the filler got it is its own
business. Two ways to get it (§6.4): hold inventory, or buy the output through
1Click with `depositType: INTENTS` and then deliver it. **All three fillers here
hold inventory.** Source-then-deliver is specified, not demonstrated — §14 lists
it first among the unverified items, and it stays there until it is timed end to
end. The honest summary: Hallmark enforces the bound on NEAR and does not need
liquidity of its own, but the cross-chain sourcing that would draw on Intents'
is a documented path, not a shipped one.

---

## Everything at once

```bash
./verify.sh              # ~3 minutes
./verify.sh --fast       # ~30 seconds, skips the sandbox integration suite
```

No key, no funds, no wallet. It runs every test, re-derives every number this
README and the site state, and then asks the live mainnet contract — anonymously
— whether NEAR Intents really signed the 99.99%-loss quote, what it prices that
quote's floor at, and whether a malformed magnitude is refused. Non-zero if
anything disagrees.

```
▸ The live contract on NEAR mainnet, asked anonymously
  PASS  NEAR Intents really signed the 99.99%-loss quote (is_signed = true)
  PASS  and the contract prices its floor at 10000 bps — a total loss
  PASS  an overflowing magnitude panics rather than pricing a fill at zero (§8.4)
  PASS  the register answers with no key: 2 agreement(s) in force
```

The sections below are the same things one at a time, with what each one proves.
**Do this — see that.** Nothing needs a key or funds unless it says so.

### Every claim, and the thing that settles it

| claim | settled by |
|---|---|
| NEAR Intents really signed a quote that guarantees a 99.99% loss | `malicious_quote_is_a_9999_bps_haircut_and_is_validly_signed`, and `is_signed` on mainnet with no key |
| all 692 bytes are covered by that signature | `every_single_byte_is_covered_by_the_signature` — each byte flipped, each rejected |
| the contract prices a 500 bps `appFee` it is not allowed to read | `the_malicious_quote_is_refused_at_its_floor_but_fine_at_its_expected_fill` (§2.3) |
| a signature alone is not enough — a stale quote is refused | `a_stale_quote_is_refused_even_though_it_is_signed_and_inside_its_deadline`, and on-chain in `3JKAnmbAnQKM141iT3fd4Pk2jhTLjBmmYC3Gk4vp6Zyc` |
| the filler delivers first, so nobody ever holds a counterparty's funds | the 28 sandbox tests; §2.4 for why it is load-bearing |
| whoever writes a byte pays for it, and the vault never subsidises | `the_vault_never_pays_for_state_someone_else_created` |
| the reported cost is never below the true cost | `the_reported_cost_is_never_below_the_true_cost` (§8.1), and §8.4 for the overflow that broke it |
| three canonicalisers agree byte for byte and hash for hash | `frontend/src/lib/hallmark.test.ts` against `client/` and the Python fixtures |
| every number on the site is a keyless view call, not a literal | `python3 frontend/tools/check.py` — 12 claims, re-derived from source and chain |
| every number in this README is still true | the same script; it fails if any of them drifts |
| it works on mainnet, filled and withdrawn by two different accounts | §3.17 of ARCHITECTURE.md — every transaction hash, and `open_mandate_count` answers live |
| a spend-policy guard approves a payment that loses 99.99% | `cd client && npm run policy` — the shape written out, run against both captures |
| what it is **not** | `/limits`, and §14 — fourteen known limits, written down before anyone asked |

## 1. See a validly signed quote that guarantees a 99.99% loss

```bash
cargo test
```

**See:** 60 tests pass — 32 unit, 28 against a real sandbox node. No network, no
key, no funds. Four of them are the point:

| test | what it shows |
|---|---|
| `malicious_quote_is_a_9999_bps_haircut_and_is_validly_signed` | `fixtures/worst.quote.json` is a real NEAR Intents quote. `amountOut` says 2.14 wNEAR for $10, which is true. `minAmountOut` says 0.000214 wNEAR, which is also true, and is what was guaranteed |
| `every_single_byte_is_covered_by_the_signature` | all 692 bytes, flipped one at a time, each rejected |
| `a_stale_quote_is_refused_even_though_it_is_signed_and_inside_its_deadline` | a signature is not enough. The quote's `deadline` is chosen by whoever asked for it |
| `the_malicious_quote_is_refused_at_its_floor_but_fine_at_its_expected_fill` | 503 bps of `appFees` priced exactly, from a field the contract cannot read |

## 2. Ask the live contract, with no key

```bash
near contract call-function as-read-only hallmarkfi.near worst_cost \
  json-args "$(python3 -c 'import json;print(json.dumps({"canonical":open("contract/fixtures/worst.canonical.json").read()}))')" \
  network-config mainnet now
```

**See:**

```
quote_signer()                            ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc
is_signed(malicious quote)                true          <- NEAR Intents really signed it
worst_cost(...)                           10000 bps     <- the guaranteed floor
realised_cost(at full fill)                 503 bps     <- the 500 bps of appFees, priced
quote_age_secs(...)                       how stale those USD marks are

dry_check, 300 s age bound                REFUSED QuoteTooOld { … max_age_secs: 300 }
dry_check at the floor,  30 bps ceiling   REFUSED CostCeilingBreached { worst_bps: 10000, ceiling_bps: 30 }
dry_check at full fill, 600 bps ceiling   ALLOWED at 503 bps realised all-in cost
```

That 503 is the part worth staring at. `appFees` is **not covered by the
signature**, so the contract cannot read it — and prices it to the basis point
anyway, because the fee's effect is already inside the signed `amountOutUsd`.

```bash
near contract call-function as-read-only hallmarkfi.near get_mandates \
  json-args '{}' network-config mainnet now
```

**See:** a real mandate, open right now, with its ceiling and its age bound.

## 3. See what a live quote actually guarantees

```bash
cd client && npm install
npm run bound -- USDC NEAR 100
```

**See:** a freshly signed quote from the public 1Click API, and the bound the
contract would enforce on it. `dry: true` quotes are free and commit nothing.

```
  100 USDC -> wNEAR

  in                 $99.992400000000
  out                $99.569842049448      22.681057 wNEAR
  guaranteed floor                     22.454247 wNEAR
  slippageTolerance  100 bps   <- what a policy engine reads

  realised cost if the fill is honoured in full   43 bps
  GUARANTEED-WORST all-in cost                    142 bps   <- what the venue actually promised

  signed at          2026-11-02T04:11:19.284Z   (1s ago)
  deadline           2026-11-02T05:11:19.284Z   <- chosen by whoever asked, not by the venue
  signature valid    true  (against ed25519:reYaWhvwu8Jz...)
```

The gap between those two cost lines is the product. The gap between `signed at`
and `deadline` is why mandates bound the first and not the second.

## 4. Open the site

```bash
cd frontend && npm install && npm run dev
```

**See:** the site at `localhost:5173`.

| page | carries |
|---|---|
| `/` | the exploit as an artifact, the invariant, FINRA 26-15, the live vault |
| `/book`, `/mandate/:id` | **the product.** The live register, and every agreement priced against a real quote — then filled |
| `/post`, `/account/:id` | post an agreement, manage a position |
| `/fill` | **the other side.** What a filler earns, the four changes that turn NEAR's own agent into one, and what is open right now |
| `/verify` | paste any quote; the contract rules on it |
| `/how` | the mechanism in three figures, each one folded over the full clause |
| `/limits` | everything this is not |

Signing is the one thing that loads third-party code, and only when you click
**connect**: a full-access signature needs a wallet, which needs a wallet
library. Every action also renders the exact transaction and the exact `near`
command that performs it, from the same builder — so the command you copy
cannot drift from the transaction the button sends, and you never have to
connect anything to use it.

**Every number on every page is a keyless view call to `hallmarkfi.near`.** The
site canonicalises quotes and does nothing else, so there is no figure it could
have invented and no server between you and the chain.

```bash
python3 frontend/tools/check.py              # the app's claims, against the code and the chain
python3 frontend/tools/mkfixtures.py --check # no signed quote is ever hand-typed
npm --prefix frontend test                   # 99 tests, no network
```

`npm run build` emits a static `dist/`; `frontend/vercel.json` carries the
headers and the single-page rewrite.

## 5. Watch a spend-policy guard approve a 99.99% loss

```bash
cd client && npm run policy
```

Every agent-guard project on NEAR implements the same shape: a recipient
allowlist, a per-transaction cap, a daily cap, an allowed-method list. Eight
more of them were posted during this hackathon alone. This writes that shape
out plainly and runs it against both captures. No key, no funds, no network,
and nobody else's code.

**See:** the same verdict twice.

```
honest.quote.json   the agent signs: ft_transfer_call, $10.00 → intents.near
                    the guard says: APPROVED
                    slippageTolerance it would read, if it could: 100 bps
                    ACTUAL guaranteed-worst all-in cost: 160 bps

worst.quote.json    the agent signs: ft_transfer_call, $10.00 → intents.near
                    the guard says: APPROVED
                    appFees, unsigned and unreadable: 250bps→attacker-wallet.near, 250bps→…
                    ACTUAL guaranteed-worst all-in cost: 10000 bps
```

The guard is not being careless. **The loss is not in the transaction it
inspects.** An agent swapping through 1Click signs `ft_transfer_call` of the
origin asset; `amountOut`, `minAmountOut`, `amountOutUsd` and `appFees` live in
the quote, which is off-chain and is not an argument to that call. Both
payments are the same size, to the same place, by the same method.

And handing the guard the quote would not fix it. Look at the honest one: its
`slippageTolerance` says 100 bps and its guaranteed-worst all-in cost is 160,
because slippage is not the only thing sitting between `amountOut` and
`minAmountOut`.

A policy engine bounds **who** may be paid and **how much**. Hallmark bounds
**the price** — against what actually arrived, measured on four figures the
venue signed.

## 6. Watch three different agents price the same mandate

```bash
cd client && npm run race
```

**See:** three independently-written fillers looking at one live signed quote,
disagreeing about strategy and landing inside the same bound — and the invariant
computed three ways, by the reference client, by an implementation written from
the spec alone, and by the contract.

| | strategy | written from |
|---|---|---|
| `src/bin/fill.ts` | splits the spread | the architecture |
| `src/fillers/edge.ts` | patient — needs a minimum edge, computes the cost itself | **§2.1 and §5.3 alone**, without reading `fill.ts` |
| `src/fillers/adapted.ts` | the official NEAR Intents agent flow, pointed at a vault | [`near/agent-skills`](https://github.com/near/agent-skills), skill `near-intents` |

`adapted.ts` is NEAR's own `rules/server-example.md` with four changes, marked
`[1]`..`[4]` in the source. The biggest one: the official agent sends the
*origin* asset to a `depositAddress`; a filler sends the *destination* asset to
the vault, because `depositAddress` is not covered by the venue's signature.

### Become the fourth filler

Nobody grants permission and nothing registers you. The register is a keyless
view call, and the contract never asks who you are — it reads what arrived and
whether it breaks the owner's terms.

```bash
npm run bound      # what a live quote actually guarantees — no key, no funds
npm run race       # three fillers price the same mandate — no key, no funds

export NEAR_ACCOUNT=you.near                 # a key is needed only here
npm run fill       # deliver against an open agreement, and be credited
```

The spread **is** the fee: you keep the gap between what you sourced the output
for and what you delivered, and it is already inside the owner's ceiling. There
is no fee field because there is nothing to take one from. The capital
requirement is real — you deliver first, so you need inventory or you carry the
price risk while you source it — and that is the price of closing the
`depositAddress` hole rather than living with it.

`fill` asks `dry_check` what the contract would rule *before* it spends
anything, so it never pays for a delivery that will be refused. `/fill` on the
site is the same thing with the open agreements listed beside it.

**What is not claimed:** there is no third-party filler ecosystem. Three
fillers, all written or adapted by us.

## 7. Post a mandate, and fill one

Needs a key and funds. Mainnet only — there is no Intents testnet.

```bash
# an owner, once. Prepays storage if needed, then posts.
HALLMARK_ACCOUNT=you.near HALLMARK_KEY=ed25519:... \
  npm run post -- NEAR USDT 0.1 --ceiling 300 --max-quote-age 300

# anyone, repeatedly
npm run fill -- --dry            # price every open mandate, send nothing
npm run fill:edge -- --audit     # the independent filler, nothing sent
npm run fill:adapted -- --dry    # the adapted official agent, nothing sent
HALLMARK_ACCOUNT=filler.near HALLMARK_KEY=ed25519:... npm run fill
```

A filler prepays storage too — whoever creates state pays for it, including the
credit slots a fill creates. One deposit, reusable.

**See:** [`DEPLOY.md`](DEPLOY.md) — step by step, with the real costs, and what
comes back.

## What it costs to run

| | |
|---|---|
| a whole fill, on mainnet | **30.48 TGas** — 10% of one transaction's limit |
| opening a mandate | the **measured** cost of its record, ~0.003 NEAR, returned by `reap` |
| filling one | the measured cost of the credit slots it creates, charged to the filler |
| the contract | 274,286 bytes, which NEAR stakes 2.77 NEAR against |

## Layout

```
verify.sh                    every claim in this README, in one command
contract/src/quote.rs        the signed quote, the signature, the arithmetic
contract/src/mandate.rs      the mandate, the typed refusals, the check
contract/src/lib.rs          the vault
contract/src/tests.rs        32 unit tests — every guarantee the spec claims
contract/tests/integration.rs 28 tests, end to end against a real node
client/src/lib/canonical.ts  canonicalisation — the one place it exists
client/src/bin/bound.ts      what a live quote guarantees
client/src/bin/post.ts       the owner
client/src/bin/fill.ts       the reference filler
client/src/fillers/          the three competing fillers + the race harness
frontend/src/pages/          the site: overview, register, agreement, post, account, verify, how, limits
frontend/src/lib/hallmark.ts the shared runtime: view calls, canonicalisation, tx builders
frontend/src/lib/fill.ts     filling an agreement; post.ts opens one
frontend/src/wallet/         signing — the only code that loads a third-party library
frontend/tools/check.py      re-verifies the app's claims against source + chain
fixtures/                    signed captures + the canonicalisation script
ARCHITECTURE.md              the full specification
```

The integration tests stand up `wrap.near`, `eth.bridge.near` and
`hallmark.near` in a local node and fill a mandate using a real NEAR Intents
signature. Nothing is mocked.

## Specification

[`ARCHITECTURE.md`](ARCHITECTURE.md) — every number verified against mainnet or
the live API, with reproduction commands. §2.10 and §2.11 are two holes an audit
found in the version that was already live, and how they were closed. §14 lists
every open item and known limit.

## Status

`hallmarkfi.near` still holds a full-access key, so the contract can still be
upgraded. §10.2 explains why that key is deleted last rather than first, and
§2.10 is the argument: an audit found a critical bug in a contract that was
already live, and a contract with no key could not have been fixed.

## The other submission

*Hackathon rule Q-015: one person may enter up to two projects if they are
independent and each README names the other.*

**Hallmark** is led by **Madhav Gupta** and is the project submitted here.

**Docket** is a separate project led by **Aditi**, who also contributed the
frontend work on Hallmark. The two are independent: different problems,
different contracts, no shared code, and neither depends on the other.

<!-- REQUIRED BEFORE SUBMITTING: add Docket's public repository URL on the line
     below. frontend/tools/check.py fails until a github.com link appears next
     to the word "Docket", because Q-015 is a rule and not a courtesy. -->

> Docket's repository: _to be added before submission._

## Libraries, and what was already here

*Hackathon rules Q-005 (list every library and template) and Q-002/Q-004
(disclose anything pre-existing).*

**Baseline: none.** Hallmark was started on 2026-11-01, inside the window, and
every commit in this repository is hackathon work. There is no earlier product,
no ported contract and no pre-hackathon library of ours in the tree.

**Contract** — `near-sdk` 5.24.1 (pinned: it is the newest release that compiles
on rustc 1.86, and nearcore's VM rejects wasm from anything newer), `bs58`,
`serde`. Tests add `near-workspaces`, `tokio`, `serde_json`, `anyhow`. No
arithmetic library: `mul_div`, the ISO-8601 parser and the civil-date conversion
are written out in `contract/src/quote.rs` so the whole bound is readable in one
file.

**Client** — `near-api-js` and `@near-js/crypto` to sign, `bs58`,
`json-stable-stringify` (the canonical form 1Click's own SDK relies on), `tsx`,
`typescript`.

**Frontend** — React 19, `react-router-dom`, `@tanstack/react-query`,
`@near-wallet-selector/core` with the Meteor and HERE modules, `near-api-js`,
`radix-ui` and `shadcn` for the dialog and button primitives,
`class-variance-authority`, `cn`, `lucide-react`, `@fontsource` for the three
self-hosted typefaces, `buffer` (a polyfill the wallet selector needs), Tailwind
4 via `@tailwindcss/vite`, `tw-animate-css`. Build and test: `vite`, `vitest`,
`oxlint`, `typescript`.

**Templates and generated code.** No starter template: `frontend/` began as
`npm create vite` and everything in `src/` was written for this project. The
shadcn dialog and button primitives are the upstream generated components,
trimmed here to the parts this app renders. AI-generated code is covered under
*AI tooling* below.

**Not ours, and not vendored:** the signed quotes in `fixtures/` are genuine
NEAR Intents API responses, captured and committed verbatim so the signature
still verifies. `client/src/fillers/adapted.ts` is NEAR's own
[`agent-skills`](https://github.com/near/agent-skills) `rules/server-example.md`
with four marked changes, which is the point of that file.

## Licence

MIT — see [LICENSE](LICENSE).

## AI tooling

This project was built with AI assistance (Anthropic's Claude, via Claude Code)
for code, tests and prose, under line-by-line human review. Everything it
produced was checked by running it: the contract is deployed on NEAR mainnet,
the 60 Rust tests and 54 client assertions run from a clean clone, and
`frontend/tools/check.py` re-verifies the app's factual claims against the source
and the live chain rather than against anybody's recollection.

The two vulnerabilities in §2.10 and §2.11 were found by auditing a version that
was **already live**, and both were found by *measuring* — printing real
`storage_usage` deltas, replaying a genuinely signed three-day-old quote against
the deployed contract — not by reasoning about the code. Three wrong fixes are
recorded in ARCHITECTURE.md alongside the right one for the same reason.
