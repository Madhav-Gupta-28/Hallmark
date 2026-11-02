# Hallmark

**A not-held order that enforces its own execution bound.**

> **Live on NEAR mainnet: [`hallmarkfi.near`](https://nearblocks.io/address/hallmarkfi.near)**

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

---

Every section below is **do this — see that**. Nothing here needs a key or funds
unless it says so.

## 1. See a validly signed quote that guarantees a 99.99% loss

```bash
cargo test
```

**See:** 58 tests pass — 30 unit, 28 against a real sandbox node. No network, no
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

## 4. Open the proof page

```bash
cd web && python3 -m http.server 8000
```

**See:** one static file — no build step, no backend, no dependencies, no
external scripts. It fetches a live signed quote, canonicalises it in the
browser, and asks `hallmarkfi.near` what that quote guarantees. **Every number
it shows is a view call to the live contract**; the page computes only the
canonical bytes, and `web/index.html` is short enough to read in full.

Deploys to any static host as-is.

## 5. Watch three different agents price the same mandate

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

## 6. Post a mandate, and fill one

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
| a whole fill, on mainnet | **30.25 TGas** — 10% of one transaction's limit |
| opening a mandate | the **measured** cost of its record, ~0.003 NEAR, returned by `reap` |
| filling one | the measured cost of the credit slots it creates, charged to the filler |
| the contract | 257,314 bytes, which NEAR stakes 2.57 NEAR against |

## Layout

```
contract/src/quote.rs        the signed quote, the signature, the arithmetic
contract/src/mandate.rs      the mandate, the typed refusals, the check
contract/src/lib.rs          the vault
contract/src/tests.rs        30 unit tests — every guarantee the spec claims
contract/tests/integration.rs 28 tests, end to end against a real node
client/src/lib/canonical.ts  canonicalisation — the one place it exists
client/src/bin/bound.ts      what a live quote guarantees
client/src/bin/post.ts       the owner
client/src/bin/fill.ts       the reference filler
web/index.html               the proof page — one file, no backend
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

## Licence

MIT
