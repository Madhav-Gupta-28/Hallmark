# Deploying Hallmark to NEAR mainnet

There is no Intents testnet and none is planned, so mainnet is the only place
this can run. The amounts below are tiny and every number was checked against
the live network on 2026-11-01.

Read §0 before running anything: **step 11 is irreversible.**

---

## §0 What this costs, exactly

Everything below was measured against mainnet on 2026-11-01. NEAR was $4.40 and
the gas price was 100,000,000 yocto/gas.

### The floor is the storage lock, and it is a protocol rule

NEAR charges **0.00001 NEAR per byte** of account storage, held as a lock rather
than a fee. The contract is 235,171 bytes, so:

| | bytes | NEAR |
|---|---|---|
| contract code | 235,304 | **2.35304** |
| account record | 182 | 0.00182 |
| state after one fill | ~540 | 0.00540 |
| **the vault must hold at least** | | **2.47** |

That number cannot be negotiated down, only shrunk by shrinking the contract.
Building with `--no-abi` saves 2 KB and nothing else is low-hanging, so treat
**2.5 NEAR as the real floor.**

> **Measured the hard way.** The figure moves with the contract: v1's wasm was
> 235,304 bytes and locked 2.36 NEAR, v2's is 257,314 and locks 2.57. Funding the
> vault with exactly the code's own byte cost made the
> deploy fail with `the remaining balance will not be enough to cover storage`,
> asking for **0.1120767046792826 NEAR** more. The code lock is only part of it:
> the deploy burns its own gas from the same account, and `new` writes contract
> state. Fund with **2.5 NEAR** and it goes through first time.

### The mandate's own storage, 0.0154 NEAR

Opening a mandate costs the opener about **0.01536 NEAR** of storage staking,
prepaid with `storage_deposit` and returned by `cancel` (§2.11). One payment
covers however many mandates you open and close in sequence.

### Everything else is small

| item | NEAR |
|---|---|
| gas, all ~12 transactions (30–300 TGas each) | ~0.09 |
| `storage_deposit` × 4 pairs, at 0.00125 each | 0.005 |
| owner's side: 0.1 wNEAR | 0.1 *(comes back)* |
| filler's side: ~0.44 USDT | ~0.1 worth *(comes back)* |

### The minimum: 3 NEAR, about $13

**Buy 3 NEAR. Buy nothing else.** Swap ~$0.50 of it to USDT on Rhea on-chain —
deep wNEAR/USDT liquidity is exactly why this pair was chosen (§0.2).

### How much of it you get back

Almost all of it — **unless you run §11.**

| | NEAR | recoverable? |
|---|---|---|
| vault storage lock | 2.57 | **yes** — `delete-account beneficiary YOU` returns the whole balance |
| mandate storage | 0.0154 | **mostly** — `cancel`, then `reap`, then `storage_withdraw` |
| `storage_deposit` × 4 | 0.005 | yes — `storage_unregister` on each token |
| the trade legs | 0.2 | yes — unwrap the wNEAR, swap the USDT back |
| gas, burned | ~0.09 | no |
| execution cost of the test trade | ~0.003 | no — this is the 2.76% the mandate allowed |

**If you keep the vault's key: real cost is ~0.1 NEAR, about $0.44.**

### §11 is what makes it unrecoverable, and that is the whole trade

Deleting the vault's full-access key (§11) is what makes "nobody to switch it
off" literally true. It also means **nobody can delete the account either**, so
the **2.57 NEAR is locked forever.**

| | permanent cost |
|---|---|
| keep the key | **~0.1 NEAR (~$0.44)** |
| delete the key | **~2.46 NEAR (~$10.80)** |

$10.80 is a fair price for a claim that is literally true rather than
aspirational. But the cost is identical whenever you pay it, so there is no
reason to pay it early and every reason not to: **keep the key through the
build, and delete it only just before submitting.** Two weeks of being able to
fix a bug is worth far more than ten dollars.

If you keep it, say so in the README. A project that admits a key exists is more
credible than one that claims immutability it has not executed.

Before the final immutable deploy it is also worth shrinking the contract — the
lock is 0.00001 NEAR per byte, so every 100 KB removed is 1 NEAR you never lose.

### Use 0.1 wNEAR as the order size

1Click signs quotes down to **0.01 wNEAR ($0.04)**, verified:

| order | realised cost at full fill | guaranteed-worst |
|---|---|---|
| 2 wNEAR | 48 bps | 147 bps |
| 1 wNEAR | 65 bps | 164 bps |
| 0.25 wNEAR | 103 bps | 202 bps |
| **0.1 wNEAR** | **178 bps** | **276 bps** |
| 0.01 wNEAR | 1300 bps | 1387 bps |

Fixed routing costs dominate a small order, so the bound gets *worse* as the
order shrinks — which makes a cheap test a better demonstration, not a weaker
one. At 0.1 wNEAR the venue's own signed floor is a **2.76% haircut**, and a
mandate with a 300 bps ceiling accepts it while a 200 bps ceiling refuses it
on-chain. Both are worth showing.

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
**140 bps** guaranteed-worst. See §0 for the full size/cost curve.

---

## §1 Prerequisites

```bash
near --version          # near-cli-rs 0.23.6 or newer
rustup toolchain list   # 1.86 must be present; ./build.sh installs it if not
```

You need a funded mainnet account to pay for all of this; §3 makes one. Every
command below writes it as `YOU.near` — substitute yours, which may be a
64-character implicit account id rather than a name.

**Nothing below ever needs a private key in plaintext.** Every signing step uses
`sign-with-keychain`, which reads the key your OS keychain holds.

## §2 Build the wasm

```bash
./build.sh
```

This uses **rustc 1.86 deliberately**. nearcore cannot execute wasm from 1.87 or
newer: the contract would deploy successfully and then fail every single call
with `CompilationError(PrepareError(Deserialization))`. See ARCHITECTURE.md
§3.14 — this is the single most expensive trap in the project.

Expect `target/near/hallmark/hallmark.wasm`, about 235 KB.

## §3 Get a funded mainnet account — no wallet required

**You do not need a browser wallet for this.** The CLI can make an account and
keep its key in your OS keychain, which is also the only way to sign these
commands without a private key ever being pasted anywhere.

```bash
near account create-account fund-later use-auto-generation \
  save-to-keychain network-config mainnet
```

That prints a 64-character **implicit account id** and stores its key in your
keychain. Buy NEAR on any exchange and withdraw **3 NEAR** to that id — the
account comes into existence the moment it receives funds.

Check it arrived:

```bash
near account view-account-summary <THE_64_CHAR_ID> network-config mainnet now
```

> **If you would rather use a wallet:** prefer **Meteor** or **HERE**.
> **Do not use MyNearWallet** — it was scheduled for deprecation on
> **2026-10-31**. Whatever you use, import the account into the CLI afterwards
> with `near account import-account using-seed-phrase` or
> `using-private-key`, because every step below signs through the keychain.

An implicit account works perfectly as the funder and as the owner/filler. A
pretty `you.near` name is optional and costs extra.

## §4 Create the vault account

```bash
near account create-account fund-myself hallmarkfi.near '2.5 NEAR' \
  autogenerate-new-keypair save-to-keychain \
  sign-as <YOUR_ACCOUNT> \
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

### Redeploying over an existing vault

`with-init-call new` fails if the account already holds state — `#[init]`
refuses to overwrite. Use `migrate` instead, which is `#[init(ignore_state)]`
and `#[private]`, so only the account itself can call it:

```bash
near contract deploy hallmarkfi.near \
  use-file target/near/hallmark/hallmark.wasm \
  with-init-call migrate json-args '{}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config mainnet sign-with-keychain send
```

Two things to know before doing this:

- **Fund the account for the new code first.** NEAR stakes 1e19 yoctoNEAR per
  byte, so a bigger wasm needs more locked balance before the deploy will land.
  Going from v1's 235,304 bytes to v2's 257,314 needed another 0.22 NEAR.
- **v2 uses new storage prefixes** (`M`/`C`/`S`, not `m`/`c`). `Mandate` gained
  a field, and borsh cannot read a v1 record into a v2 struct, so the old bytes
  are left where they are rather than being misread. That strands about 360
  bytes — 0.0036 NEAR — of dead state, which is the honest price of changing a
  struct that is already live. Old mandate ids are not reused: `mandate_count`
  restarts from zero and the v1 transactions stay on the explorer.

This path exists because an audit found a critical bug in a contract that was
already deployed (ARCHITECTURE.md §2.10). It is also why §11 is done last: once
the full-access key is gone, there is no `migrate`.

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

### And prepay the vault's own storage

Separate from the token registrations above, and easy to miss. Opening a mandate
writes a record, and **the vault does not stake NEAR for state you create** —
ARCHITECTURE.md §2.11 explains why that is not an inconvenience but the fix for
a cheap denial-of-service. Ask the contract what it will charge, then prepay it:

```bash
near contract call-function as-read-only hallmarkfi.near storage_cost_estimate \
  json-args '{}' network-config mainnet now
# "15360000000000000000000"   -> 0.01536 NEAR

near contract call-function as-transaction hallmarkfi.near storage_deposit \
  json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0.0154 NEAR' \
  sign-as YOU.near network-config mainnet sign-with-keychain send
```

Paid once, not per mandate: the next `open` reuses whatever is left, and
`reap(mandate_id)` on a cancelled mandate returns the rest.
`npm run post` does all of this for you and skips it when the balance already
covers the next mandate — this section is here so the number is not a surprise.

## §7 Get the two legs

```bash
# owner: NEAR -> wNEAR
near contract call-function as-transaction wrap.near near_deposit \
  json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' \
  sign-as YOU.near network-config mainnet sign-with-keychain send
```

For the filler's USDT, swap ~0.12 wNEAR on Rhea. **Pool 5470** is the one to
use at this size — 1 bp fee, and it quotes 0.12 wNEAR → 0.5218 USDT. Pool 6063
is far deeper (43,904 wNEAR / 194,056 USDT) at 30 bps if you need size. Of
8,992 Rhea pools, 22 hold wNEAR + native USDT; the rest are dust.

> **A pair that needed no DEX was tried and rejected.** `wNEAR → stNEAR` is
> ideal on paper, because both legs come from native NEAR with a single call
> (`wrap.near::near_deposit`, `meta-pool.near::deposit_and_stake`) and 1Click
> signs it at 180 bps full / 278 bps worst. But Meta Pool's
> `min_deposit_amount` is **1 NEAR**, which does not fit inside a 3 NEAR
> budget once the vault takes 2.5. Hence the Rhea hop.

If you are using one account as both owner and filler — which §0.1 explains is
the honest v1 case — you only need that one account registered, and `FILLER.near`
below is the same account as `YOU.near`.

## §8 Post the mandate

```bash
cd client && npm install
HALLMARK_VAULT=hallmarkfi.near \
HALLMARK_ACCOUNT=YOU.near HALLMARK_KEY=ed25519:... \
  npm run post -- NEAR USDT 0.1 --ceiling 300 --max-quote-age 300
```

`--max-quote-age` is in seconds and defaults to 300. It bounds how old the USD
marks a fill is priced against may be. It is **not** optional in the contract and
there is no sensible "off": a cost ceiling priced from stale marks is not a
ceiling, which is exactly the hole ARCHITECTURE.md §2.10 describes. The quote's
own `deadline` cannot do this job, because the filler chooses it and 1Click will
sign one ten years out.

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
