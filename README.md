# Hallmark

**A not-held order that enforces its own execution bound.**

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

## The bound

```
cost = 1 − (amountOutUsd × delivered / amountOut) / amountInUsd
```

Four signed fields and the amount that actually arrived. Every cost — slippage,
bridge fee, solver spread, app fee — has already moved those numbers before the
venue signed them, so there is nothing else to check.

## Layout

```
contract/src/quote.rs     the signed quote, the signature, the arithmetic
contract/src/mandate.rs   the mandate, the refusals, the check
contract/src/lib.rs       the vault
contract/src/tests.rs     every guarantee the spec claims
fixtures/                 signed captures + the canonicalisation script
ARCHITECTURE.md           the full specification
```

## Specification

[`ARCHITECTURE.md`](ARCHITECTURE.md) — every number verified against mainnet or
the live API on 2026-11-01, with reproduction commands, and every open item and
known limit listed in §14.

## Licence

MIT
