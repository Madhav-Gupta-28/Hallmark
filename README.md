# Hallmark

**A not-held order that enforces its own execution bound.**

> **Live on NEAR mainnet: [`hallmarkfi.near`](https://nearblocks.io/address/hallmarkfi.near)**

A not-held order hands discretion over the time and price of your trade to
somebody else. For a century the only thing protecting the client was a promise —
the best execution obligation. NEAR Intents signs the economics of every fill, so
on NEAR that promise can be a number instead.

An owner funds a mandate: a pair, a worst acceptable all-in cost, a maximum fill,
an expiry. Anyone may fill it. The filler delivers the output first, and the
contract verifies that delivery against NEAR Intents' own signature before the
filler is credited with the input.

No oracle. No price feed. No custodian. No admin key.

---

## The quote that passes every policy engine and guarantees a 99.99% loss

`fixtures/worst.quote.json` is a real, cryptographically valid NEAR Intents
quote. `amountOut` says 2.14 wNEAR for $10, which is true. `minAmountOut` says
0.000214 wNEAR, which is also true, and is what the venue actually guaranteed.

```bash
cd contract && cargo test
```

21 tests, no network, no key, no funds. Two of them are the point:

- `malicious_quote_is_a_9999_bps_haircut_and_is_validly_signed`
- `every_single_byte_is_covered_by_the_signature` — all 692 bytes, flipped one at a time

## The proof page

```bash
cd web && python3 -m http.server 8000
```

One static file, no build step, no backend, no dependencies. It fetches a live
signed quote from the public 1Click API, canonicalises it in the browser, and
asks `hallmarkfi.near` what the quote actually guarantees. Every number it shows
is a view call to the live contract — nothing is computed by the page except the
canonical bytes, and `web/index.html` is short enough to read in full.

Deploys to any static host as-is.

## Ask the live contract, right now

No key, no funds, no deposit — these are view calls on mainnet.

```bash
near contract call-function as-read-only hallmarkfi.near worst_cost \
  json-args "$(python3 -c 'import json;print(json.dumps({"canonical":open("contract/fixtures/worst.canonical.json").read()}))')" \
  network-config mainnet now
```

```
quote_signer()                 ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc
is_signed(malicious quote)     true          <- NEAR Intents really signed it
worst_cost(...)                10000 bps     <- the guaranteed floor
realised_cost(at full fill)    503 bps       <- the 500 bps of appFees, priced

dry_check at the floor,  30 bps ceiling   REFUSED CostCeilingBreached { worst_bps: 10000, ceiling_bps: 30 }
dry_check at full fill,  30 bps ceiling   REFUSED CostCeilingBreached { worst_bps: 503,   ceiling_bps: 30 }
dry_check at full fill, 600 bps ceiling   ALLOWED at 503 bps realised all-in cost
```

That 503 is the part worth staring at. `appFees` is **not covered by the
signature**, so the contract cannot read it — and prices it to the basis point
anyway, because the fee's effect is already inside the signed `amountOutUsd`.

## The bound

```
cost = 1 − (amountOutUsd × delivered / amountOut) / amountInUsd
```

Four signed fields and the amount that actually arrived. Every cost — slippage,
bridge fee, solver spread, app fee — has already moved those numbers before the
venue signed them, so there is nothing else to check.

## See what a live quote actually guarantees

No key, no funds, nothing deployed. `dry: true` quotes are free and commit
nothing.

```bash
cd client && npm install
npm run bound -- USDC NEAR 100
```

```
  100 USDC -> wNEAR

  in                 $99.992400000000
  out                $99.569842049448      22.681057 wNEAR
  guaranteed floor                     22.454247 wNEAR
  slippageTolerance  100 bps   <- what a policy engine reads

  realised cost if the fill is honoured in full   43 bps
  GUARANTEED-WORST all-in cost                    142 bps   <- what the venue actually promised

  signature valid    true  (against ed25519:reYaWhvwu8Jz...)
```

The gap between those last two lines is the product.

## Run it

```bash
./build.sh                                  # the deployable wasm (needs rustc 1.86)
cd contract && cargo test                   # 21 unit tests
cargo test --test integration               # 5 tests against a sandbox node
cd ../client && npm install && npm test      # the canonicaliser, vs signed fixtures
```

The integration tests stand up `wrap.near`, `eth.bridge.near` and
`hallmark.near` in a local node and fill a mandate using a real NEAR Intents
signature. Nothing is mocked, and a whole fill costs **7.8 TGas**.

## Posting and filling

```bash
# an owner, once
HALLMARK_ACCOUNT=you.near HALLMARK_KEY=ed25519:... \
  npm run post -- USDC NEAR 100 --ceiling 200

# anyone, repeatedly
HALLMARK_ACCOUNT=filler.near HALLMARK_KEY=ed25519:... npm run fill
npm run fill -- --dry        # price every open mandate, send nothing
```

## Layout

```
contract/src/quote.rs       the signed quote, the signature, the arithmetic
contract/src/mandate.rs     the mandate, the refusals, the check
contract/src/lib.rs         the vault
contract/src/tests.rs       every guarantee the spec claims
contract/tests/             end-to-end, against a real node
client/src/lib/canonical.ts canonicalisation — the one place it exists
client/src/bin/bound.ts     what a live quote guarantees
client/src/bin/fill.ts      the reference filler
web/index.html              the proof page — one file, no backend
fixtures/                   signed captures + the canonicalisation script
ARCHITECTURE.md             the full specification
```

## Mainnet

[`DEPLOY.md`](DEPLOY.md) — step by step, with real costs (about 5.2 NEAR and
5 USDT, and the capital comes back). There is no Intents testnet and none is
planned, so mainnet is the only place this runs.

## Specification

[`ARCHITECTURE.md`](ARCHITECTURE.md) — every number verified against mainnet or
the live API on 2026-11-01, with reproduction commands, and every open item and
known limit listed in §14.

## Licence

MIT
