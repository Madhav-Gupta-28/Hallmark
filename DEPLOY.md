# Deploying Hallmark to NEAR mainnet

There is no Intents testnet and none is planned, so mainnet is the only place
this can run. The amounts below are tiny and every number was checked against
the live network on 2026-11-01.

Read §0 before running anything: **step 11 is irreversible.**

---

## §0 What this costs, exactly

| item | amount | why |
|---|---|---|
| vault account, funded | **4 NEAR** | 2.3517 NEAR is *locked* as storage for the 235,171-byte wasm (0.00001 NEAR/byte), the rest covers state growth and gas |
| `storage_deposit`, per (account, token) | **0.00125 NEAR** | NEP-141 requires it before an account can hold or receive a token. 6 pairs here → 0.0075 NEAR |
| gas, everything below | **< 0.02 NEAR** | a whole fill costs 7.8 TGas |
| owner's test capital | **~1.2 wNEAR** (~$5) | what gets sold |
| filler's test capital | **~5 USDT** | the filler delivers the output *first*, so it needs inventory (ARCHITECTURE.md §6.4) |

**Total: about 5.2 NEAR and 5 USDT.** The two capital legs come back to you —
you are both sides of this trade.

## §0.1 Why you are both sides, and why that is not a cheat

Hallmark's guarantee is not "someone will trade for me". It is "I need not trust
whoever does." The owner and the filler being the same person exercises every
line of the contract, and §6.1 of the spec says plainly that on day one the
filler is the owner's own agent. Nothing here claims a live filler ecosystem.

## §0.2 The pair, and why this one

**wNEAR → USDT.**

| | |
|---|---|
| origin | `nep141:wrap.near`, 24 dp |
| destination | `nep141:usdt.tether-token.near`, 6 dp |

Both are listed on Intents **and** obtainable on NEAR by swapping NEAR, so no
bridging is involved. That is not true of Intents USDC, which is the omni-bridge
token `nep141:17208628…33a1` and has almost no NEAR-native liquidity
(ARCHITECTURE.md §3.12).

Live, 2026-11-01, for 1.2 wNEAR: **40 bps** if the fill is honoured in full,
**140 bps** guaranteed-worst. A 200 bps ceiling accepts it; a 50 bps ceiling
refuses it on-chain.

---

## §1 Prerequisites

```bash
near --version          # near-cli-rs 0.23.6 or newer
rustup toolchain list   # 1.86 must be present; ./build.sh installs it if not
```

You need an existing funded mainnet account to pay for all of this. Everything
below calls it `YOU.near` — substitute yours.

## §2 Build the wasm

```bash
./build.sh
```

This uses **rustc 1.86 deliberately**. nearcore cannot execute wasm from 1.87 or
newer: the contract would deploy successfully and then fail every single call
with `CompilationError(PrepareError(Deserialization))`. See ARCHITECTURE.md
§3.14 — this is the single most expensive trap in the project.

Expect `target/near/hallmark/hallmark.wasm`, about 235 KB.

## §3 Put your key in the CLI keychain

```bash
near account import-account using-web-wallet network-config mainnet
```

Never paste a private key into a terminal that logs, and never into this repo.

## §4 Create the vault account

```bash
near account create-account fund-myself hallmarkfi.near '4 NEAR' \
  autogenerate-new-keypair save-to-keychain \
  sign-as YOU.near \
  network-config mainnet sign-with-keychain send
```

**This must happen before step 8.** 1Click refuses to sign a quote whose
`recipient` is not an existing on-chain account, and reports it as HTTP 400
`Internal server error`, which reads like an outage and is not (ARCHITECTURE.md
§3.11). Verified with a control: `demo.near` quotes fine, a non-existent account
is rejected every time.

`hallmark.near` was already registered by someone else, hence `hallmarkfi.near`.

## §5 Deploy and initialise

```bash
near contract deploy hallmarkfi.near \
  use-file target/near/hallmark/hallmark.wasm \
  with-init-call new json-args '{}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config mainnet sign-with-keychain send
```

Confirm it answers:

```bash
near contract call-function as-read-only hallmarkfi.near quote_signer \
  json-args '{}' network-config mainnet now
```

Expect `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`.

**Verify the bound before trusting the deployment**, using the signed fixture
that guarantees a 99.99% loss:

```bash
near contract call-function as-read-only hallmarkfi.near worst_cost \
  json-args "$(python3 -c '
import json
print(json.dumps({"canonical": open("contract/fixtures/worst.canonical.json").read()}))')" \
  network-config mainnet now
```

Expect `10000`. If the live contract says 10000 bps on a quote whose `amountOut`
looks healthy, the verifier is working.

## §6 Register storage

Three accounts × two tokens. `FILLER.near` can be a subaccount you make for the
purpose, e.g. `filler.YOU.near`.

```bash
for TOKEN in wrap.near usdt.tether-token.near; do
  for WHO in hallmarkfi.near YOU.near FILLER.near; do
    near contract call-function as-transaction "$TOKEN" storage_deposit \
      json-args "{\"account_id\":\"$WHO\"}" \
      prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
      sign-as YOU.near network-config mainnet sign-with-keychain send
  done
done
```

## §7 Get the two legs

```bash
# owner: NEAR -> wNEAR
near contract call-function as-transaction wrap.near near_deposit \
  json-args '{}' prepaid-gas '30 Tgas' attached-deposit '1.3 NEAR' \
  sign-as YOU.near network-config mainnet sign-with-keychain send
```

For the filler's USDT, swap a little NEAR on any NEAR DEX and send it to
`FILLER.near`. Roughly 5 USDT is plenty.

## §8 Post the mandate

```bash
cd client && npm install
HALLMARK_VAULT=hallmarkfi.near \
HALLMARK_ACCOUNT=YOU.near HALLMARK_KEY=ed25519:... \
  npm run post -- wNEAR USDT 1.2 --ceiling 200
```

Check it landed:

```bash
near contract call-function as-read-only hallmarkfi.near get_mandates \
  json-args '{}' network-config mainnet now
```

## §9 Fill it

Price every open mandate without sending anything:

```bash
HALLMARK_VAULT=hallmarkfi.near npm run fill -- --dry
```

Then, for real:

```bash
HALLMARK_VAULT=hallmarkfi.near \
HALLMARK_ACCOUNT=FILLER.near HALLMARK_KEY=ed25519:... \
  npm run fill
```

The filler obtains a live signed quote, asks the contract's own `dry_check`
before spending, then delivers the USDT. The contract verifies the venue's
signature, computes the realised cost, and credits both sides in the same
transaction.

## §10 Withdraw, and check the receipt

```bash
for PAIR in "YOU.near nep141:usdt.tether-token.near" "FILLER.near nep141:wrap.near"; do
  set -- $PAIR
  near contract call-function as-transaction hallmarkfi.near withdraw \
    json-args "{\"asset\":\"$2\"}" \
    prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
    sign-as "$1" network-config mainnet sign-with-keychain send
done
```

The fill emits a receipt you can read straight off the explorer:

```
EVENT_JSON:{"standard":"hallmark","version":"1.0.0","event":"filled",
  "data":[{"mandate_id":"1","filler":"filler.you.near","amount_in":"...",
           "delivered":"...","cost_bps":40,"ceiling_bps":200}]}
```

`cost_bps` is what the owner actually paid, proven against the venue's own
signature. That line is the submission.

## §11 Make it immutable — irreversible, do it last

"Nobody to switch it off" is only true if you execute it.

```bash
near account list-keys hallmarkfi.near network-config mainnet now
near account delete-keys hallmarkfi.near \
  public-keys ed25519:THE_KEY_FROM_ABOVE \
  network-config mainnet sign-with-keychain send
```

After this the contract **cannot be upgraded, paused or redeployed by anyone,
including you**. A bug found later can only be superseded by a new deployment
that owners migrate to voluntarily. That is the trade stated in ARCHITECTURE.md
§10.2, and it is the thing that makes the `defi` claim literally true.

Do not run step 11 until steps 8–10 have worked end to end at least once.

---

## Troubleshooting

| symptom | cause |
|---|---|
| every call fails `CompilationError(PrepareError(Deserialization))` | wasm built with rustc ≥ 1.87. Rebuild with `./build.sh` (§2) |
| 1Click returns HTTP 400 `Internal server error` | the `recipient` account does not exist on-chain yet (§4) |
| 1Click returns HTTP 403 | the request has no `User-Agent`. Not an auth problem |
| `The account … is not registered` | missing `storage_deposit` for that (account, token) pair (§6) |
| `REFUSED CostCeilingBreached` | working as intended. Raise `--ceiling`, or wait for a better quote |
| `REFUSED UnderDelivered` | the filler sent less than the venue's own signed floor |
| `no Hallmark vault deployed at …` | `HALLMARK_VAULT` points at an account with no code |
