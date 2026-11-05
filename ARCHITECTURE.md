# Hallmark — Architecture

**A not-held order that enforces its own execution bound.**

> The not-held order has required trusting your broker for a century, because
> best execution is a promise rather than a mechanism. NEAR Intents signs the
> economics of every fill, so the promise can be replaced with arithmetic.

---

## §0 How to read this file

This is the complete specification. Someone with no prior context should be able
to build Hallmark from this document alone, from an empty directory to a
production deployment.

Every number, address, account, method name and interface below was **verified
against NEAR mainnet, the live 1Click API, or the published source on
2026-11-01**. Reproduction commands are given inline so any reader can re-check
rather than trust. Where a claim is an assumption or is not yet verified it is
marked **ASSUMPTION** or **UNVERIFIED** in bold, and §14 lists every one in a
single place.

Four conventions:

- **Corrections are kept, not deleted.** Where an earlier belief was wrong and
  testing killed it, the wrong version is stated alongside the right one. The
  wrong versions are the expensive part of this document, and §2.8 is a ledger
  of every design that was tried and discarded.
- **Where published documentation disagrees with the network, the network
  wins**, and the disagreement is recorded.
- **Nothing is asserted that a test does not cover.** §12 is the audit: if a
  guarantee is claimed here, a named test enforces it.
- **No marketing.** Every sentence is a mechanism, a measurement, or a stated
  limit. §15 is the one section allowed to be prose, because it exists to be
  copied into a README and a landing page.

---

## §1 The problem

### 1.1 The primitive that already exists

A **not-held order** is an order where the client keeps control of the asset, the
direction and the size, but hands the broker **discretion over the time and the
price of execution**. It is codified in FIX as `ExecInst (tag 18) = 1 — Not
held`, against `5 — Held`. A held order must be worked for immediate execution; a
not-held order may be worked for a better result.

What protects the client in a not-held order is **not a number**. It is the
broker's *best execution obligation* — in the US, FINRA Rule 5310's "reasonable
diligence" standard. The protection is a legal promise, enforced after the fact,
measured against a benchmark.

> **Correction kept.** An earlier draft placed "not held" at `HandlInst (tag
> 21)`. That is wrong. Tag 21 carries `1` / `2` / `3` — automated private,
> automated public, manual. Not-held lives at `ExecInst`, tag 18.

### 1.2 That promise is under formal review, right now

This is the answer to the only question that genuinely threatened this project:
*are we building before the problem is real?*

On **2026-07-24** FINRA issued **Regulatory Notice 26-15**, a request for comment
on modernising best execution guidance under Rule 5310. Comments closed
**2026-09-25**. Section 7 raises exactly two concerns about not-held orders:

1. the use of broad or **"blanket" not-held provisions** in retail account
   agreements; and
2. situations where a retail customer's **held order is subsequently routed as
   not held**.

Both are the same failure. **The client's protection lives in prose that someone
else drafted**, so it can be applied wholesale, or re-labelled in transit. FINRA
also asks whether **safe harbors** under Rule 5310 — specified routing or review
methodologies deemed compliant — would help.

Separately, on **2026-06-11** the SEC proposed Regulation NMS amendments
including **rescinding Rule 611**, which puts in question the NBBO benchmark the
promise was measured against in the first place.

So the century-old primitive for delegating execution discretion is, in 2026,
the subject of an open regulatory docket about whether its protection means
anything. Nobody has proposed replacing the promise with arithmetic, because in
equities there is no venue that cryptographically signs the economics of a fill.

**A provable bound is what a safe harbor looks like when it is engineered
instead of legislated.** That is the thesis.

### 1.3 On NEAR, the arithmetic is available

NEAR Intents' 1Click API signs a quote. The signature covers the input amount,
the expected output, the **minimum** output, and a **USD mark on both sides**.
That is enough to compute, with no oracle and no price feed, the all-in cost of a
fill — and to refuse it on-chain if that number breaches a bound the owner
signed.

### 1.4 The concrete failure this prevents

A NEAR Intents quote can be **cryptographically valid, look entirely healthy on
every field a policy engine reads, and still guarantee a 99.99% loss.**

`slippageTolerance` is accepted up to `9999` basis points. It is a *signed*
field, so a policy engine that reads it sees a real number — but almost nothing
reads it: spend caps read amounts, allowlists read addresses. And `amountOut` —
the field a human or an LLM glances at — stays healthy, because `amountOut` is
the *expected* fill, not the guaranteed one.

The captured, signature-verified fixture in `fixtures/worst.quote.json`:

| field | value |
|---|---|
| `amountIn` | `10000000` (10.00 USDC) |
| `amountInUsd` | `9.999220000000` |
| `amountOut` | `2143675304305483601119090` (2.1437 wNEAR) |
| `amountOutUsd` | `9.496481598073` |
| `minAmountOut` | `214367530430548360111` (**0.000214 wNEAR**) |
| `slippageTolerance` | `9999` |
| signature | valid, by `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc` |

`minAmountOut / amountOut = 0.0001`. The guaranteed-worst all-in cost is
**9999.05 bps — 99.99%.** Every spend cap passes. Every allowlist passes.
`amountOut` says 2.14 wNEAR for ten dollars, which is correct and irrelevant.

And a second, quieter failure is in the same fixture: honoured *in full*, that
quote still costs **503 bps**, because 500 bps of `appFees` are already baked
into the signed `amountOutUsd`. Hallmark catches that without reading `appFees`
at all — it cannot, the field is unsigned (§2.3).

### 1.5 Why "the agent is yours" is not a defence

The failure does not require a malicious agent. It requires an agent that is
*wrong* — prompt-injected, mis-prompted, running a stale route, or carrying a
bug. An owner's own agent is precisely the thing that gets prompt-injected.

Hallmark's value is not "I found someone to trade for me." It is **"I do not have
to trust whoever trades for me, including myself."**

---

## §2 Why this mechanism is correct

### 2.1 The one invariant

Everything collapses to one expression over four signed fields and one observed
amount:

```
                 amountOutUsd × (delivered / amountOut)
realised_cost = 1 ─ ─────────────────────────────────────
                             amountInUsd
```

Read it in three steps:

1. `amountOutUsd` marks what the output is worth **at `amountOut`** — the
   expected fill.
2. Multiplying by `delivered / amountOut` re-marks it at **what actually
   arrived**.
3. Dividing by `amountInUsd` turns it into a cost ratio against what went in.

Setting `delivered = minAmountOut` gives the **guaranteed-worst** case, which is
the number §1.4 turns on. Setting it to what a filler actually delivered gives
the **realised** cost, which is the number the contract enforces.

What makes this correct rather than merely plausible: **every cost is already
inside those numbers.** Slippage, the bridge fee, the solver's spread, the
withdraw fee and any app fee have all already moved `amountOut`, `minAmountOut`
or the USD marks before the venue signed them. There is nothing left to
enumerate, so there is no policy grab-bag and no list to keep current.

### 2.2 No oracle, by construction

The invariant needs no price feed, no pool reserves, no RPC call and no
cross-contract call. Both USD marks are **inside the signed payload**. The
contract reads bytes it was handed and does integer arithmetic.

This is the entire reason Hallmark can be chain-abstract. Every comparable system
derives a reference price from somewhere chain-local — an oracle contract, a
pool's reserves, an allowlisted signer — which is why every comparable system is
single-chain. Hallmark bounds the *intent*, not a chain-specific transaction, so
one verifier covers every asset and chain Intents lists.

### 2.3 The unsigned fields, and why none of them matter

`appFees` and `depositAddress` are **not** covered by the signature. The 1Click
SDK builds the signed payload with `appFees: void 0`
(`sdk/package/dist/index.mjs:1617`), and `depositAddress` is assigned after
signing.

Verified directly against the fixtures:

```
signed set: amount, amountIn, amountInFormatted, amountInUsd, amountOut,
            amountOutFormatted, amountOutUsd, deadline, depositType,
            destinationAsset, dry, minAmountIn, minAmountOut, originAsset,
            recipient, recipientType, refundTo, refundType, slippageTolerance,
            swapType, timestamp
appFees        in signed set: False
depositAddress in signed set: False
```

Hallmark reads **neither**, and needs neither:

- **`appFees`** — its *effect* is inside `amountOutUsd`, which is signed.
  Measured by re-quoting the same swap at three fee levels, the computed cost
  moved 0.47% → 2.76% → 5.26%. The contract checks the **total**; the fee is
  already in the total. Test:
  `the_malicious_quote_is_refused_at_its_floor_but_fine_at_its_expected_fill`.
- **`depositAddress`** — never used, because the contract never sends the
  owner's funds anywhere a filler nominated (§2.4).

> **Correction kept.** Two earlier positions on `appFees` were wrong.
> (a) "The skim is effectively unbounded." It is capped at exactly **500 bps**
> (501 returns HTTP 400) and **split 50/50 with 1Click**, so a third party's
> true maximum is **250 bps**.
> (b) "Pay fillers through `appFees`, turning the exploit into the business
> model." Rejected: a declared value in an unsigned field is unverifiable.
> (c) A later draft said the mandate "forbids `appFees`". **Also wrong, and
> impossible** — the contract cannot see a field that is not in the bytes it
> verifies. The correct word is *immune*, not *forbidden*.

### 2.4 The filler delivers first. This is the load-bearing decision

An earlier design had the vault send the owner's tokens to the quote's
`depositAddress`, wait ~10–20s for the swap, then verify the arrival by reading
its own balance.

**That design was robbable, and the hole is `depositAddress` being unsigned.** A
filler supplies the deposit address; a malicious filler supplies its own; the
vault hands over the owner's funds and the attacker keeps them. The signature
proves nothing about where the money went.

**This is not a hypothetical class of bug, and the evidence arrived five weeks
before this was written.** On 1 October 2026 NEAR Intents itself lost ~$3.8M to
a fault in how its Omni deposit-and-withdrawal layer interacted with its main
contract; the protocol halted, and the funds came back because the attacker was
identified and returned them, not because the design made the loss impossible.
Two things follow, and the second matters more than the first.

The layer that failed is the layer Hallmark does not use. Hallmark depends on
1Click's **signature over a quote** — a read-only, verifiable artifact — and
never on Intents holding, routing or releasing a balance on its behalf. No
address a counterparty nominated is ever sent anything, because the vault only
ever credits an account that has already delivered.

And the honest half: this is a *reduction* of trust, not an elimination of it.
§3.1 and §9 still carry the real dependency — if 1Click's signing key is stolen,
every bound here is forgeable, and that is listed as unmitigated. The claim is
narrow and exact: Hallmark removes the custody-and-routing class of failure that
actually occurred, and keeps the signing-key class, which did not.

The fix inverts the order of operations:

> **The filler transfers the output into the vault first. The vault verifies the
> delivery against the signed quote synchronously, and only then credits the
> filler with the input.**

The filler calls `ft_transfer_call` on the **destination** token with the quote
in `msg`. The vault's `ft_on_transfer` receives, in one synchronous call and with
no promises at all:

| from | value |
|---|---|
| `env::predecessor_account_id()` | **which token** was delivered |
| `sender_id` | **who** delivered it |
| `amount` | **how much** arrived |
| `msg` | the canonical quote bytes + signature + mandate id |

Everything needed to verify is present at once. Three separate problems vanish:

1. **No unsigned field is ever trusted.** `depositAddress` is unused.
2. **No delivery-attribution problem.** The amount is a function argument, not a
   balance delta, so concurrent fills cannot be confused for one another and a
   filler cannot claim credit for someone else's delivery.
3. **No custody window.** The output is in the vault before the input is
   released. There is no interval in which either party is exposed.

The cost of this choice is stated honestly in §6.3: the filler must **front the
output**, so it needs destination-asset inventory or must source it first and
bear that risk itself. That is what a dealer does, and it is the price of
removing a hole that cannot otherwise be closed.

### 2.5 The filler's pay is the spread, so there is no fee field

Because the filler delivers an amount of its own choosing — at or above the
quote's signed floor — its compensation is simply **what it keeps**: the gap
between what it could source the output for and what it delivered.

That number is already inside the owner's ceiling, because the ceiling is
enforced on the realised cost. So the mandate needs no fee field, no fee rail,
no fee accounting, and no second asset.

Competition acts on the right variable: a filler that delivers more lowers the
owner's cost and still profits, and `delivering_above_the_floor_lowers_the_owners_realised_cost`
pins the arithmetic — the honest fixture costs **160 bps** at its floor and
**60 bps** at its expected fill.

> **Correction kept.** An earlier draft gave the mandate a `max_filler_fee_bps`
> and paid the filler explicitly on proven delivery. Once the filler delivers
> first, that is double-paying: the spread *is* the fee. The field was built,
> tested, and then removed.

### 2.6 Canonicalisation, deleted rather than solved

Re-serialising JSON inside a contract to re-derive a hash is a reliable way to
lose a week: Rust and TypeScript must agree byte-for-byte on key order, number
formatting and unicode escaping, forever.

Hallmark has no canonicalisation code in Rust at all. The client builds the
canonical byte string (`json-stable-stringify`); the contract is handed **those
exact bytes** and does:

```
sha256(bytes) → base58 → ed25519_verify(sig, that_string, signer) → from_slice(THE SAME bytes)
```

Hash first, parse second, same bytes both times. If a single byte of the 692
differs from what the venue signed, verification fails before any field is read.
`every_single_byte_is_covered_by_the_signature` asserts this by flipping each of
the 692 bytes in turn.

### 2.7 Honest prior art

Bounded delegated execution is a known pattern; the arXiv survey *Autonomous
Agents on Blockchains: Standards, Execution* (2601.04583) names "bounded
execution" explicitly. The claim here is narrow and must stay narrow. Two of
these appeared **days before** the build window and were read in full, not
merely cited.

| system | who is the price authority | enforced where | what is bounded | chains |
|---|---|---|---|---|
| `agent-wallet-sdk` #98 (2026-10-25) | "a source independent of the swap RPC", unnamed | **off-chain, in the SDK** | token floor | one |
| `TreasuryPilot` #542 | **a signer the project allowlists** — its own threat model says "the signer is the price authority" | on-chain | token floor | one (EIP-712 `chainId`) |
| `Envelope` | pool reserves at trade time | on-chain | token floor | one |
| ERC-8377 (draft) | a reference oracle | on-chain | reference-relative slippage | one |
| **Hallmark** | **the counterparty itself** | **on-chain** | **realised all-in cost, in USD** | **38** |

Both new entries are good engineering. The distinctions that matter:

- **`agent-wallet-sdk` enforces in the SDK.** An SDK check binds the honest
  agent and not the compromised one — a prompt-injected agent simply does not
  call the SDK. This is the single most common shape of a wrong answer to this
  problem.
- **`TreasuryPilot` moves the trust rather than removing it.** Its EIP-712
  quotes, balance-delta enforcement, route hash, nonce and expiry are all
  correct, and its signed struct (`taker`, `recipient`, `tokenIn`, `tokenOut`,
  `amountIn`, `minAmountOut`, `venue`, `routeHash`, `expiry`, `nonce`) is close
  kin to a mandate. But the signer is one *the project controls*. If that signer
  lies, the treasury is drained with a valid signature.
- **A token floor bounds one leg.** `minAmountOut` alone says nothing about
  whether the floor is a *good* floor. Only the USD marks turn it into a cost.

Hallmark's one novel move: **use the counterparty's own signature as evidence
against the counterparty.** No oracle, no friendly signer, nobody to trust. The
reason nobody has done it is that it requires a venue that signs the economics
of a fill, and on EVM no such venue exists. 1Click does.

### 2.8 Design ledger — what was tried and killed

Kept because it is the most useful thing here for anyone rebuilding this.

| design | killed by | §ref |
|---|---|---|
| Benchmark 1Click against on-chain Rhea liquidity | measurement: 0 of 8,992 pools hold Intents-USDC + wNEAR | §3.12 |
| Policy grab-bag (caps, allowlists, per-protocol rules) | collapses to one invariant; six public repos already do the grab-bag | §2.1, §3.16 |
| Re-serialise JSON in Rust to re-derive the hash | hash-then-parse removes the problem entirely | §2.6 |
| `appFees` as the filler compensation rail | unsigned ⇒ unverifiable | §2.3 |
| Mandate "forbids" `appFees` | impossible; the contract cannot see the field | §2.3 |
| Vault deposits to the quote's `depositAddress` | `depositAddress` is unsigned ⇒ filler can nominate its own and steal | §2.4 |
| Verify delivery by reading a balance delta | cannot attribute concurrent fills; a filler can claim another's delivery | §2.4 |
| Explicit `max_filler_fee_bps` paid on delivery | double-pays; the spread already is the fee | §2.5 |
| Bound quote staleness with the signed `deadline` | the **filler** chooses the deadline, and 1Click signs one 10 years out | §2.10 |
| Let the vault stake storage for any mandate anyone opens | ~10× leverage; ~10 cents bricks a live vault | §2.11 |
| Zero a credit slot on withdrawal instead of removing it | a zeroed slot still costs the vault storage | §2.11 |
| Permissionless `fund` | a gift with no mechanism behind it; a footgun with no upside | §2.11 |
| Claim "best execution" | a bound is provable, optimality is not | §2.9 |
| Claim the idea is uncontested | ERC-8377, Envelope, and two repos from Oct 2026 | §2.7 |
| NEAR AI attestation of the filler | needs a key, only 17 of 64 models attestable, answers a question no judge asks | — |

### 2.9 What is explicitly not claimed

- **Not best execution.** Hallmark proves a *bound* and enforces a *realised
  cost*, not optimality. With one filler and first-come-first-served, the filler
  delivers near the floor and keeps the spread; the owner gets their ceiling, not
  the best price in the market. A **sealed-bid, commit-then-deliver** auction is
  the documented next step (§14.7), not a v1 claim.
- **Not an independent price benchmark.** Killed by measurement (§3.12).
- **Not a reputation or counterparty-scoring system.** No account-age
  heuristics, no blocklists, no contract-change detection. Six public NEAR repos
  already do that (§3.16).
- **Not a custodian, ever.** No design in §2.8 that involved holding a
  counterparty's funds survived.

### 2.10 The stale-quote hole, and the field that closes it

**Found by auditing v1 after it was already live on mainnet. It was the most
serious defect in the project, and it defeated the headline claim.**

The invariant is denominated in `amountInUsd` and `amountOutUsd`. Those two
numbers were true **when the venue signed**, and not necessarily now. v1's only
freshness check was the quote's own `deadline`:

```rust
if now_secs >= deadline_secs { return Err(Refusal::QuoteExpired { .. }) }
```

**`deadline` is supplied by whoever requests the quote, and 1Click signs it
unquestioned.** Measured live on 2026-11-01:

```
asked +   1d  signed=true  quote is valid for 1 days     worst=157bps
asked +  30d  signed=true  quote is valid for 30 days    worst=157bps
asked + 365d  signed=true  quote is valid for 365 days   worst=157bps
asked +3650d  signed=true  quote is valid for 3650 days  worst=157bps
```

Ten years. And `dry: true` quotes are free, unauthenticated and **still signed**
(§3.4). So the attack costs nothing to set up:

1. A filler asks 1Click for a quote matching an open mandate, with a deadline
   years out. Free, no key, no JWT.
2. It does this repeatedly and keeps the signed quotes. It now holds a library
   of **free options on the owner's escrow**, each struck at the prices of the
   day it was minted.
3. It waits. When the destination asset falls against the origin asset, it
   exercises whichever banked quote has become most profitable.
4. The vault computes the cost from the quote's own frozen USD marks, reports a
   number inside the ceiling, and releases the escrow.

The owner's `max_cost_bps` was enforced exactly — against a market that no
longer existed. The realised loss is the whole adverse move and is unbounded.

**This was demonstrated against the v1 contract live on mainnet**, keylessly and
for nothing, using a fixture signed three days earlier:

```
LIVE MAINNET  hallmarkfi.near  (v1)
quote signed at  2026-10-29T18:05:30.496Z   <- 3.01 days ago
quote deadline   2026-11-20T00:00:00.000Z
is_signed        true
dry_check        ALLOWED at 60 bps realised all-in cost, filler earns 10000000 origin units
```

A three-day-old quote, priced at three-day-old marks, allowed at 60 bps.

**The fix uses a field that was already inside the signature.** `timestamp` —
when the venue signed — is in the canonical bytes and always was; v1 simply
never read it. The mandate gains one number:

```rust
pub max_quote_age_secs: u32,
```

and `check` gains the only test that can bound staleness:

```rust
let signed_at_secs = parse_iso8601_secs(&q.timestamp);
if now_secs > signed_at_secs + m.max_quote_age_secs as u64 {
    return Err(Refusal::QuoteTooOld { signed_at_secs, now_secs, max_age_secs });
}
```

Why `timestamp` and not `deadline`: **`timestamp` is written by the venue,
`deadline` is written by the counterparty.** The whole design rests on trusting
only what the counterparty cannot choose, and this is that distinction applied
one level deeper than v1 applied it. The same reasoning that rejects
`depositAddress` (§2.4) rejects `deadline` as a freshness bound.

Four tests pin it, two of them on-chain:

| test | asserts |
|---|---|
| `a_stale_quote_is_refused_even_though_it_is_signed_and_inside_its_deadline` | validly signed, in-deadline, refused |
| `the_freshness_bound_is_exact_to_the_second` | allowed at exactly the bound, refused one second past |
| `the_signing_time_is_covered_by_the_signature` | `timestamp` cannot be edited after signing |
| `a_quote_older_than_the_mandate_allows_is_refused_on_chain` | `QuoteTooOld` in a real runtime, filler loses nothing |

The ceiling on `max_quote_age_secs` is **30 days**, and it is a sanity bound
rather than a policy: the contract's job is to enforce the age the owner
committed to, not to pick it. The client defaults to **300 seconds**, the value
is visible in `get_mandates` for anyone to read, and `quote_age_secs(canonical)`
is a keyless view so a filler or a judge can see the number the bound is
enforced against.

> **Correction kept.** An earlier version of this document said the signed
> `deadline` made the quote's age a non-issue — "the deadline is signed" appears
> in §9's failure table. The deadline *is* signed. It is also chosen by the
> adversary, which makes it worthless as a bound, and signing it changes
> nothing. Being signed and being trustworthy are different properties, and
> conflating them is how this got shipped.

### 2.11 The vault does not pay for state strangers create

**Also found by audit, also live on mainnet in v1.**

`ft_on_transfer` carries no attached deposit, so v1's `open` wrote a
`MandateRecord` and the **vault's own balance** was staked against it. NEAR
locks 1e19 yoctoNEAR per byte, so each mandate cost the vault roughly 0.003–0.005
NEAR of locked balance against roughly 0.0003 NEAR of attacker gas: about
**ten times leverage, pointed at the vault.**

Measured on the live v1 deployment:

```
storage_usage   236,202 bytes
locked for that 2.36202 NEAR
balance         2.65647 NEAR
FREE headroom   0.29445 NEAR  -> 29,444 more bytes of state
```

Roughly **a hundred spam mandates — about ten cents of gas — and the vault
cannot write state at all.** Not just new mandates: every `fill`, every
`withdraw`, every `cancel`. A griefer with no stake and no interest in the
protocol could stop it, and after the full-access key is deleted (§10.2) nobody
could clear the junk.

The fix is the oldest rule on NEAR, which v1 skipped, in one sentence:

> **Whoever causes a byte to be written pays for that byte, exactly.**

| method | kind | effect |
|---|---|---|
| `storage_deposit(account_id?)` | call, payable | prepay. One deposit covers many mandates and many fills, and it pays for its own ledger entry |
| `storage_withdraw(amount?)` | call, payable | take back whatever is not in use |
| `storage_balance_of(account_id)` | **view** | what is prepaid |
| `storage_cost_estimate()` | **view** | a *recommended* deposit — see below |
| `reap(mandate_id)` | call | delete a closed record and get back the storage it frees |

There is exactly one implementation of the rule, `settle_storage`, and every
path that mutates state ends in it:

```rust
fn settle_storage(&mut self, who: &AccountId, before: u64) {
    self.mandates.flush();
    self.open_ids.flush();
    self.credits.flush();
    let after = env::storage_usage();
    if after > before {
        let owed = bytes_to_near(after - before);
        require!(balance >= owed, "prepay storage first: …");
        // deduct
    } else if before > after {
        // credit back bytes_to_near(before - after)
    }
}
```

Nothing is estimated and nothing is rounded into an allowance. The figure is the
**measured** difference in `env::storage_usage()`, so:

- `open` charges the owner for the record and its index entry — ~300 bytes;
- `fill` charges **the filler** for the credit slots the fill creates, which is
  what makes a mandate's exposure to fillers bounded rather than unbounded;
- `fund` creates nothing, so it costs nothing;
- `withdraw` releases a slot and returns its bytes — but only in the callback,
  **after the payout actually lands**, because a failed payout puts the slot
  back and its storage was therefore never released;
- `cancel` settles the **net**: it removes the open-id index entry and may
  create a credit slot for the returned escrow, so it can land either way —
  measured, 39 bytes come *back*, because the index entry is larger than the
  slot. What it never does is hand back the record's storage, because the record
  is still there;
- `reap` returns precisely the bytes deleting the record frees.

Attacker leverage goes from roughly 10× to exactly **1×**, which is the only
number that is actually safe, and `storage_cost_estimate()` stops being a price
and becomes a recommendation: deposit ~0.01 NEAR, get charged what you use,
withdraw the rest.

> **Two corrections kept, because both earlier versions of this fix were wrong
> and both were caught the same way — by measuring instead of reasoning.**
>
> **(a)** The first attempt charged a fixed `512 + 4 × 256` bytes at `open` and
> had `cancel` return the whole prepayment while leaving the **296-byte** record
> in place. Opening and cancelling in a loop therefore still cost the vault 296
> bytes a cycle and refunded the owner in full: 5× leverage instead of 10×,
> which is not a fix. A mandate record measures 296 bytes and a credit slot 145;
> neither number was knowable without running it.
>
> **(b)** The second attempt kept the fixed charge but split `cancel` and
> `reap`. That closed the loop but left ~0.0118 NEAR per cycle unrefunded and
> still had a residual hole: the allowance covered about seven credit slots, and
> a mandate could attract more fillers than that. Exact accounting removes the
> hole and the overcharge together, and deletes three magic constants and a
> struct field with them.
>
> The test that would have caught both is now the first one in the list:
> `the_vault_never_pays_for_state_someone_else_created` asserts
> `charged == grew`, as an equality, not an inequality.

**The one piece of inexactness that remains, stated.** A fill charges the filler
for *both* credit slots it creates — its own and the owner's. When the owner
later withdraws, the owner is credited for releasing a slot the filler paid for:
about 0.00145 NEAR, moving from filler to owner. It is a transfer between
participants and never a loss to the vault, so the invariant holds; and it
cannot be farmed, because every such transfer requires a fill, and a fill costs
the filler a real delivery and earns it the spread — orders of magnitude more
than 0.00145 NEAR either way. Attributing slots to payers would need a per-slot
payer field, which is itself more state than the problem is worth.

Seven tests pin this, all of them on-chain and all of them **measuring** the
vault rather than trusting the arithmetic:

| test | asserts |
|---|---|
| `the_vault_never_pays_for_state_someone_else_created` | over three open+cancel cycles, `charged == grew`, exactly |
| `a_filler_pays_for_the_state_its_fill_creates` | a filler with no prepayment is refused and refunded; with one, it is charged precisely what its fill created |
| `funding_a_mandate_creates_no_state_and_is_charged_nothing` | `fund` is free because it writes nothing new |
| `a_storage_deposit_pays_for_its_own_ledger_entry` | the deposit covers its own row |
| `opening_a_mandate_has_to_be_paid_for` | no prepayment ⇒ refused and refunded |
| `a_withdrawal_releases_the_storage_it_was_using` | the slot is removed, not zeroed |
| `reaping_returns_only_the_storage_it_actually_frees` | `cancel` returns nothing, `reap` returns exactly the bytes freed, and reaping twice refuses |

### 2.12 The order book costs what the vault holds, not what it remembers

v1 and v2 answered `get_mandates` by walking **every mandate ever created** and
discarding the closed ones:

```rust
self.mandates.iter().filter(|(_, r)| r.open).skip(from).take(limit)
```

That is O(all mandates), not O(what is open). It is correct and it gets slower
forever. With ten mandates it is instant; with fifty thousand, the call has to
load and decode fifty thousand records to hand back fifty, and a view call has a
gas budget — so past some size **the only way a filler can find work stops
answering at all**, and so does the proof page.

Not a security hole: with storage now prepaid (§2.11) nobody can inflate that
number cheaply, so it is a wall the product only hits by succeeding. Which is
exactly why it is worth fixing before launch rather than after.

The fix is an index of the ids that are open:

```rust
open_ids: IterableSet<u64>,
```

`open` inserts, `cancel` removes, and `get_mandates` reads the index and fetches
only those records — so the cost tracks the length of the **book**, which is
bounded by real economic activity, instead of the vault's whole history. Ids are
never reused, `mandate_count()` still reports how many have ever existed, and
`open_mandate_count()` reports the book's length so a caller can size a page.

**And the new shape has its own ceiling, so here is the number.** O(open) is a
shape, not a bound: the index is still read in full and sorted on every call,
because an unordered set cannot be paginated in id order any other way. The
slope is measured rather than guessed —
`book_scaling_has_a_measured_ceiling_not_a_guessed_one` in
`contract/tests/integration.rs` opens mandates twenty-five at a time and reads
the gas off a real sandbox node:

| open mandates | `get_mandates(limit 25)` |
|---|---|
| 25 | 7.45 TGas |
| 50 | 9.27 TGas |
| 75 | 11.09 TGas |
| 100 | 12.91 TGas |

Exactly linear, **0.0727 TGas per open mandate**, which puts the 200 TGas view
ceiling at roughly **2,600 open mandates**. That figure is pessimistic twice
over: it is a debug build, and it is measured through a transaction rather than
a view, so both overheads are counted against it.

So the limit is real and it is about three orders of magnitude above anything
this vault has held. Raising it means an ordered index — `store::TreeMap` plus
cursor pagination (`after_id` rather than `from_index`) — which changes the
state layout and therefore needs a migration that preserves live escrow. That
is the right change at a thousand open mandates and the wrong one at two, so it
is written down here rather than done. The test fails if the slope ever
regresses far enough to matter.

`the_order_book_tracks_what_is_open_not_what_ever_existed` opens eight, closes
seven, reaps one, and asserts the index and the records never disagree —
including that pagination runs off the index and in id order.


---

## §3 Verified chain facts

Verified 2026-11-01 unless stated. Everything here has a reproduction command.

### 3.1 The 1Click quote signer

```
ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc
```

Verified to have signed both captured fixtures by an independent from-scratch
RFC-8032 ed25519 implementation (`fixtures/mkfix.py`) and again inside the NEAR
VM (`contract/src/lib.rs`, `signer_key_matches_the_published_one`).

### 3.2 Exactly which fields the signature covers

**Signed** — `dry`, `swapType`, `slippageTolerance`, `originAsset`,
`depositType`, `destinationAsset`, `amount`, `refundTo`, `refundType`,
`recipient`, `recipientType`, `deadline`, `quoteWaitingTimeMs`, `referral`,
`amountIn`, `amountInFormatted`, `amountInUsd`, `minAmountIn`, `amountOut`,
`amountOutFormatted`, `amountOutUsd`, `minAmountOut`, `timestamp`.

**Not signed** — `appFees` (`index.mjs:1617`), **`depositAddress`**,
`depositMemo`, `depositMode`, `confidentiality`, `insured`, `timeEstimate`,
`refundFee`, `withdrawFee`, `correlationId`.

The contract's `SignedQuote` struct contains only signed fields, so reading an
unsigned one is a compile error rather than a code review.

### 3.3 The quote hash, exactly

```
quoteHash = base58( sha256( json-stable-stringify({ ...signedRequest, ...signedQuote, timestamp }) ) )
```

and the ed25519 signature is over **the UTF-8 bytes of that base58 string**, not
over the digest. This is the single most load-bearing implementation detail in
the project; getting it wrong produces a verifier that rejects every real quote.

`json-stable-stringify` semantics that matter: keys sorted lexicographically,
`undefined` members omitted entirely, no whitespace.

| fixture | canonical bytes | quote hash |
|---|---|---|
| `fixtures/honest.quote.json` | 692 | `8no2rMSjesYe97Jhi6RWKxRvvYsYARBVQZXtMDMyhvwp` |
| `fixtures/worst.quote.json` | 690 | `FTTFigJiyLLbx9Um6FC17P8UvRwfuSA1DRMDeNZvTj33` |

```bash
cd fixtures && python3 mkfix.py
# honest  bytes= 692  hash=8no2rMSjesYe97Jhi6RWKxRvvYsYARBVQZXtMDMyhvwp
# worst   bytes= 690  hash=FTTFigJiyLLbx9Um6FC17P8UvRwfuSA1DRMDeNZvTj33
```

### 3.4 What the API gates, and what it does not

| endpoint | auth | verified |
|---|---|---|
| `GET /v0/tokens` | none | 210 assets across 38 chains |
| `POST /v0/quote`, `dry: true` | **none** | signed quote returned |
| `POST /v0/quote`, `dry: false` | **none** | HTTP 201 + live `depositAddress` |
| `POST /v0/orders` (limit orders) | **partner JWT** (`X-API-Key`) | 401 without |

Base URL `https://1click.chaindefuser.com`. Requests from a plain script need a
`User-Agent`; without one the host returns **HTTP 403**, which is easy to
misread as an auth requirement. It is not.

**That `dry: false` needs no JWT is what makes a permissionless venue possible.**
Any filler can obtain a live, signed, binding quote through a public endpoint.

### 3.5 1Click limit orders are a different primitive

`POST /v0/orders` takes `orderType: "LIMIT"`, `side`, `price`, `quantity`.

| | 1Click limit order | Hallmark |
|---|---|---|
| what is fixed | a **price** | a **cost ceiling** |
| discretion | none — price is the instruction | delegated: time, size, route |
| who may fill | 1Click's "trusted swapping agent" | anyone |
| access | partner JWT | public |
| custody during fill | "1Click temporarily transfers assets to a trusted swapping agent" | **nobody — atomic** |

Hallmark is not a better limit order. It is the *other* order type — the not-held
one — which 1Click does not offer.

### 3.6 `depositType: INTENTS` is signed, public, and twice as fast

Both deposit types were quoted live with `dry: false` and no JWT:

| `depositType` | `timeEstimate` | signed | `depositAddress` |
|---|---|---|---|
| `ORIGIN_CHAIN` | 20 s | yes | `bd69603f…c911af` |
| `INTENTS` | **10 s** | yes | `fc11080a…be87fd` |

This matters to the **filler**, which chooses how to source the output (§6.2).
It no longer matters to the vault, which never touches a deposit address (§2.4).

### 3.7 `appFees`: the cap, the split, and 1Click's own rake

- The cap is exactly **500 bps**; `501` returns **HTTP 400**.
- A requested 500 is **split 50/50 with 1Click**, so a third party's true
  maximum take is **250 bps**.
- **1Click inserts its own fee unprompted.** `fixtures/honest.quote.json` was
  requested with no `appFees` at all; the echoed request contains
  `[{"recipient":"5880ad2b…47dd","fee":20}]`. **1Click's own rake is 20 bps.**
  That is the right anchor for judging whether a filler's spread is reasonable.
  Re-checked on an unauthenticated quote on **2026-11-02**: still `fee: 20`.

> **Documentation disagrees with the network, and the network wins (§0).**
> NEAR's own `near-intents` agent skill states *"Auth quote or pay 0.25% —
> without an API key, an extra 25 bps fee applies to every non-`ANY_INPUT`
> quote"* (`near/agent-skills`, `skills/near-intents/SKILL.md`, read
> 2026-11-02). Every unauthenticated quote we have captured, across two
> separate days, echoes **20 bps**, not 25. Recorded rather than reconciled:
> the anchor used in §15.4 is the measured 20.
>
> It does not touch the mechanism either way. Whatever the rake is, it has
> already moved `amountOutUsd` before the venue signed it, which is the entire
> point of §2.3 — the contract prices a fee it is not told about.

### 3.8 App fees land — proven from live state, with no transaction

The default fee recipient `5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd`:

- **does not exist as a NEAR account** (`view_account` → `UNKNOWN_ACCOUNT`).
  App-fee recipients are **Intents-internal balances**, not NEAR accounts. This
  also proves `intents.near` credits arbitrary account ids with no registration.
- holds, inside `intents.near`, **$154.91 across 20 distinct assets**:

```
wNEAR         28.817381        $129.10
BTC            0.000274         $22.13
SWEAT      17653.811717          $1.54
USDC           0.891315          $0.89
AURORA        11.150988          $0.56
TURBO        152.433748          $0.13
BLACKDRAGON 14057194.007852      $0.09
… 13 more dust positions
```

Nobody deliberately funds an account with 14 million BLACKDRAGON worth nine
cents. That spread is the signature of **fee residue accruing across many swaps
of many assets.**

**This closed a question a ~$5 mainnet swap was going to answer, at zero cost.**

> Inference, stated honestly: balance alone does not prove *causation*. What is
> proven is that this account is named as 1Click's fee recipient in every quote
> captured, exists only inside `intents.near`, and holds a multi-asset residue
> consistent with fee accrual. Marked **ASSUMPTION** in §14.

```bash
curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,
 "method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":"intents.near","method_name":"mt_batch_balance_of",
 "args_base64":"'$(echo -n '{"account_id":"5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd","token_ids":["nep141:wrap.near"]}' | base64)'"}}'
```

### 3.9 `intents.near` — the method surface, probed

Methods were classified by calling each as a view with `{}` and reading the
error. A missing method gives `MethodResolveError(MethodNotFound)`; an existing
one gives a *deserialisation* panic naming its first required field. The control
case is included so the technique is auditable.

| method | result | first required field |
|---|---|---|
| `mt_batch_balance_of` | **OK** → `["0"]` | — (keyless view) |
| `mt_balance_of` | **OK** → `"0"` | — (keyless view) |
| `mt_tokens_for_owner` | **OK** → `[]` | — (keyless view) |
| `mt_transfer` | EXISTS | `receiver_id` |
| `mt_transfer_call` | EXISTS | `receiver_id` |
| `ft_on_transfer` | EXISTS | `sender_id` |
| `mt_withdraw` | EXISTS | `token` |
| `nonexistent_method_xyz` | **MISSING** — `MethodResolveError(MethodNotFound)` | — |

Also verified: `intents.near` custodies **4,742,664.64 USDC** and **is**
storage-registered on the USDC contract
(`{"total":"1250000000000000000000","available":"0"}`).

### 3.10 The storage gotcha — now a filler's problem, not the vault's

A 1Click `depositAddress` is a 64-character **implicit** NEAR account, and it is
**not storage-registered** on the token being deposited:

```
storage_balance_of(e6264b44…28dff3)  ->  null     # NOT registered
storage_balance_of(86a27b8c…038033)  ->  null     # NOT registered
storage_balance_of(intents.near)     ->  {"total":"1250000000000000000000", …}
storage_balance_bounds()             ->  {"min":"1250000000000000000000","max":"1250000000000000000000"}
```

**A plain NEP-141 `ft_transfer` to a `depositAddress` fails**, because NEP-141
panics on transfers to unregistered accounts. Anyone depositing to one must
either `storage_deposit` 0.00125 NEAR for that fresh address first, or avoid the
problem entirely by using `depositType: INTENTS` and an **`mt_transfer` inside
`intents.near`**, where crediting an account is just a map entry and needs no
registration (proved by §3.8: the fee account holds $155 and is not a NEAR
account at all).

> **Correction kept.** An earlier draft made this the *vault's* architecture —
> "deposit into `intents.near` rather than to a deposit address." That reasoning
> was right about the storage trap and wrong about who faces it. After §2.4 the
> vault never deposits anywhere, so this is guidance for the reference filler.

### 3.11 Asset → chain → recipient

Nine consecutive HTTP 400s on a USD-mark coverage sweep were **a wrong request
shape, not a limited API**:

| destination asset | settles on | recipient must be | wrong guess → |
|---|---|---|---|
| `nep141:wrap.near` | NEAR | `*.near` or 64-hex implicit | — |
| native BTC | Bitcoin | a **BTC address** | `recipient is not valid` |
| `nep141:eth.bridge.near` | **NEAR**, not Ethereum | `*.near` | `recipient is not valid` |

The rule: the recipient must match the chain the asset **settles on**, which is
not always the chain the asset is *named* after. Retested with chain-correct
recipients, USD marks were present on every quote across 6 assets on 6 chains.

**And the recipient must already exist on-chain.** 1Click refuses to sign a
quote naming a NEAR account that has not been created, and reports it as
**HTTP 400 `Internal server error`** — which reads like an outage and is not.
Verified with a control:

| recipient | exists on-chain | quote |
|---|---|---|
| `demo.near` | yes | signed |
| `hallmark.near` | yes | signed |
| `relay.tg` | yes | signed |
| `hallmarkfi.near` | **no** | **rejected** |
| `zzz-does-not-exist-9x7.near` | **no** | **rejected** |

This imposes an ordering constraint on deployment: **the vault account must be
created before any quote can name it**, so before a filler can do anything at
all. DEPLOY.md §4 puts it first for this reason.

### 3.11b The mainnet test pair

`wNEAR → USDT` — `nep141:wrap.near` (24 dp) to
`nep141:usdt.tether-token.near` (6 dp).

Both are Intents-listed **and** obtainable by swapping NEAR on a NEAR DEX, so no
bridging is involved. That is not true of Intents USDC, which is the omni-bridge
token `nep141:17208628…33a1` with almost no NEAR-native liquidity (§3.12) — it
is the right fixture for the exploit demo and the wrong asset to acquire for a
live test.

Measured live on 2026-11-01 for 1.2 wNEAR: **40 bps** at full delivery, **140
bps** guaranteed-worst. `USDT → wNEAR` gives 42 / 142.

**`hallmark.near` is already registered** by someone else (0.05 NEAR, no code),
so the deployment target is **`hallmarkfi.near`**.

### 3.12 Rhea cannot be an independent benchmark

Scanned **all 8,992** Rhea pools via `get_number_of_pools` + enumeration:

- **31** contain Intents-USDC
- **zero** contain Intents-USDC **and** wNEAR
- the ones that exist hold `['16736','16783']` (≈$0.016) or `['0','0']`

Cause: **asset fragmentation.** Intents uses omni-bridge tokens; Rhea's
liquidity sits in `factory.bridge.near` wrapped tokens and native
`usdt.tether-token.near`. Same tickers, different assets.

A `get_return` call at a guessed `pool_id: 4` failed with `E102: invalid token
id` — pool ids must be enumerated, never guessed.

**Consequence:** the "benchmark 1Click against on-chain liquidity" story is dead.
It was compelling and it was false. This is also *why* the signed USD marks are
the right reference: there is no on-chain alternative.

### 3.13 The invariant is always computable, and fails closed for free

Both USD marks were present on **every** signed quote obtained, across 6 assets
and 6 chains. Where no quote exists there is nothing to verify and nothing to
approve, so the vault refuses by default. There is no "missing price" branch.

### 3.14 The toolchain trap, which costs a day if you meet it late

This is the most expensive thing in the build, and nothing warns you until a
contract is deployed and every call fails.

**nearcore's VM only accepts MVP WebAssembly.** From rustc 1.82 on, the
`wasm32-unknown-unknown` target emits post-MVP features (reference types,
sign-extension) by default, and from **1.87** on the result is unusable. The
failure mode is the trap: `DeployContract` **succeeds**, because deploying does
not compile the module. Every subsequent call fails with

```
FunctionCallError(CompilationError(PrepareError(Deserialization)))
```

`cargo near build` refuses up front and says so plainly:

```
WARNING: wasm, compiled with 1.87.0 or newer rust toolchain is currently
         not compatible with nearcore VM
WARNING: please downgrade to 1.86.0 toolchain for compiling contracts
```

**`-C target-cpu=mvp` is not sufficient**, because the prebuilt `std` was
compiled with the newer features regardless.

That collides head-on with §3.11's other finding: **`near-sdk` 5.30.0 requires
rustc ≥ 1.95**, so 5.30 *cannot* produce a contract this VM will run. The
resolution:

| constraint | value |
|---|---|
| `near-sdk` | **`=5.24.1`** — newest that compiles on 1.86 |
| why the `=` | `"5.24.1"` means `^5.24.1`, which resolves to 5.30.0 and fails |
| `near-sys` | **`=0.2.9`** — 0.2.10 and later require rustc 1.93 |
| `serde_with` | 3.11.0 — 3.24 requires 1.88 |
| wasm toolchain | **1.86**, via `./build.sh` (`cargo +1.86 near build`) |
| test toolchain | **1.99.1**, pinned in `rust-toolchain.toml` |

Two toolchains are unavoidable: `near-workspaces`' dependency tree needs
rustc ≥ 1.88 (`encoding_rs`, the `icu_*` crates), and the contract wasm needs
≤ 1.86. `build.sh` isolates the wasm build so `cargo test` is unaffected.

### 3.14b NEAR SDK facts

Verified against the version actually shipped, `near-sdk` 5.24.1:

| fact | value |
|---|---|
| `env::ed25519_verify` | **not** behind `unstable` — plain public fn, `env.rs:773` |
| `env::ecrecover` | **is** behind `#[cfg(feature = "unstable")]`, `env.rs:707` |
| also available | `sha256_array`, `p256_verify` |
| wasm artifact, after `wasm-opt -O` | **235,171 bytes** |
| gas for a whole fill, end to end | **7.8 TGas** (§5.7) |

> **Correction kept.** An earlier draft of this section recorded `near-sdk`
> 5.30.0 and rustc 1.99.1 as the build configuration, having verified only that
> they *compile*. They do compile, and produce a contract that cannot execute a
> single call. Compiling is not the test; deploying to a node and calling it is.
> The gate placement for `ed25519_verify` and `ecrecover` was right, and is
> re-verified above against 5.24.1.

### 3.15 Market size

| fact | value | as of |
|---|---|---|
| NEAR Intents settled, September 2026 | **$4.80B** (record, +72.9% MoM) | month close |
| cumulative Intents volume | **$34.78B** | 2026-10-13 |
| 30-day DEX volume (DefiLlama) | $4.467B | snapshot |
| single-day volume | $130.7M | ~2026-10-20 |
| 1Click's own rake | **20 bps** | 2026-11-01 |

> **Correction kept.** An earlier draft used "$3.91B/month" and "$191.9M/day".
> The real September figure is **$4.80B**. The market is larger than claimed.

### 3.16 The competitive field, measured

Six NEAR agent-guard repositories existed **before the build window opened** —
one named `Mandate`, one named `Leash`. All implement the same shape: spending
caps plus allowlists plus a policy file.

This is load-bearing in two directions. It killed `security` as the primary
track. It also means the baseline Hallmark must beat is *established and
public*: every one of those six passes `worst.quote.json`. That fixture is the
differentiator, and a judge can reproduce it in one command.

**Checked again on 2026-11-05, against the hackathon itself.** The same shape
turned up eight more times in two weeks, publicly posted: Tollgate, Aegis,
NEAR Leash, SpactVault, Euthyna, Clean Exit, NearGuard and Lifeguard. Every one
is a spend-policy gate in front of an agent's key — caps, allowlists, an
approval step — and several demonstrate it the same way, by stealing their own
agent's key and showing the refusals. It is plainly the obvious idea, which is
the strongest argument available for not having built it.

The distinction is not rigour, it is *what is being bounded*. A policy gate
bounds **who** the agent may pay and **how much**, which is a bound on the
transaction. None of them bounds the **price** — a payment to an allowed
address, inside the cap, at a rate that loses 99.99%, passes every one of them,
because the quote is not what they inspect. `worst.quote.json` is a payment of
exactly that shape. The fixture is the differentiator and it costs one command
to reproduce.

### 3.17 Live on mainnet

Deployed and exercised end to end four times: **v1 on 2026-11-01**, **v2 on
2026-11-02** after the audit found §2.10 and §2.11, **v3 the same day** once
measuring showed §2.11's first fix was still inexact and §2.12 was a wall worth
removing before launch, and **v3.1 on 2026-11-05** after a second audit found
the unguarded quotient in `mul_div` (§8.4).

v3.1 is the only one of the four deployed **without `migrate`**. The guard is a
`require!` inside a function body, so the borsh layout is byte-identical and the
code could be replaced under the live state rather than beside it — which
mattered, because `migrate` calls `new()` and would have wiped both mandate
records and stranded §1's escrow. Verified after the fact: `mandate_count` 2,
§1 still holding 0.04 wNEAR at `fills 1, worst_bps 74`, §2 at `worst_bps 0`.

| | |
|---|---|
| vault | **`hallmarkfi.near`** |
| wasm (v3.1) | 274,286 bytes, sha256 `744ea248…023f71cf`, code hash `8q1qZFpXnnh3biMBHdgLzAjNQY3Y3pvNrCiQ1kLaJkLW` |
| v3.1 deploy (code only) | `4mMtctAm3AcnLSR6LrZ6T4xcnvjh7JiADJdmfdtp5xsh` |
| v3 deploy + `migrate` (superseded) | `HosgeB2W1j2nyYvbyGWigdVsXuGRanraJBfMhypkhGZw` |
| v2 deploy (superseded) | `8ndzKy5DWr4d6SorwgFKDGi8fB4RJHQv7dvcusmpqx4d` |
| v1 deploy (superseded) | `5gPd4L1uG1uNGitZr3j6XPYtwzWg1RFsq8K41KsSCBpK` |

**The v1 exploit, demonstrated against v1 and then against every version
since.** The same four arguments, the same keyless `dry_check`:

```
v1, 2026-11-01   ALLOWED at 60 bps realised all-in cost, filler earns 10000000 origin units
v2, 2026-11-02   REFUSED QuoteTooOld { signed_at_secs: 1793297130, now_secs: 1793557929, max_age_secs: 300 }
v3, 2026-11-02   REFUSED QuoteTooOld { signed_at_secs: 1793297130, now_secs: 1793639177, max_age_secs: 300 }
```

The quote is validly signed in all three cases and inside its own deadline. With
the age bound widened to 30 days v3 allows it again at 60 bps, so the refusal is
the freshness check and nothing else.

**The v3 round trip, filled by NEAR's own official agent, adapted:**

| step | tx | |
|---|---|---|
| mandate #1 opened | `Fymth8dhDi6BpnLf7R7SkGJWcV1wiupWrqhtaP2NVAZq` | 0.04 wNEAR → USDT, 300 bps, 300 s — posted **during the 1Click outage**, because posting needs nothing from the venue |
| **the fill** | `GkEZhvx9iwq4eF8wUWrsS4fUsUxiV2h3AFZGppJnrsix` | **74 bps** against a 300 bps ceiling, quote **1 second** old, 30.48 TGas, by `fillers/adapted.ts` |
| withdraw USDT | `6kjsYmbbjExWj9ogKrBVtr8BPHNorDxCkefzzyH3TQQN` | |
| withdraw wNEAR | `CqF5BbxpooA1WMNUvnWFjQxzCWMfEK6rSc5uM9RatGu6` | |

```
EVENT_JSON:{"standard":"hallmark","version":"1.0.0","event":"filled",
  "data":[{"mandate_id":"1","filler":"d3bc151a…b7bd484",
           "amount_in":"40000000000000000000000","delivered":"157389",
           "cost_bps":74,"ceiling_bps":300}]}
```

Balances before the mandate and after both withdrawals are identical —
0.040000 wNEAR, 0.518409 USDT — and every credit is zero.

**And the storage round-trips to the byte**, which is the §2.11 invariant
observed on mainnet rather than in a sandbox:

```
prepaid after opening            426 bytes
prepaid after the fill           123 bytes   <- 303 charged to the FILLER for two credit slots
prepaid after both withdrawals   426 bytes   <- both slots released, both refunded
```

**Three fillers priced the same mandate** (`npm run race`), against one live
signed quote, one second old:

```
fill.ts     (reference)          119 bps   delivers 0.156681   splits the spread
edge.ts     (independent)        169 bps   delivers 0.155894   needs 40 bps of edge
adapted.ts  (official agent)      69 bps   delivers 0.157469   delivers the expected fill
all three implementations of the invariant agree: yes
```

All three inside the owner's 300 bps ceiling, disagreeing only about strategy.
And the cross-check that matters, `npm run agree`: **39 comparisons** across all
three fixtures, from each signed floor to twice each expected fill, between the
reference client, the independent implementation, and the live contract — **0
disagreements, 0 bps maximum gap.**

**Exact storage accounting, measured on v3:**

| | |
|---|---|
| `storage_deposit` | `9W9cxb2uG9Srq8Y7jfN5EwmVTS195YEG6ycTWJFUBUzf` — 0.01024 NEAR, the *recommendation* |
| mandate #1 opened | `Fymth8dhDi6BpnLf7R7SkGJWcV1wiupWrqhtaP2NVAZq` — 0.04 wNEAR → USDT, 300 bps, 300 s |
| charged | **598 of 1,024 bytes**: 74 for the ledger row, 296 for the record, 228 for the open-id index entry |
| still withdrawable | 426 bytes — 0.00426 NEAR, which v2 would have kept |

Mandate #1 on v3 is **open now**, and `open_mandate_count()` answers `1` against
a `mandate_count()` of `1`.

**The v2 round trip** (the mechanism is unchanged in v3, and the sandbox suite
re-covers all of it):

| step | tx | |
|---|---|---|
| **the fill** | `44QgFYjtPFzmLtGonoMQKXEZVcB4moGGQDrH1Pt2ErAi` | **105 bps**, quote **1 second** old, 30.25 TGas |
| withdraw USDT | `BX2Cdkrc38zLZXkccV8Vup74kg6D7bpwxXFFQFV6fFKB` | |
| withdraw wNEAR | `GKyc767VFH3f84697C9k2AXy3xH8TpWqD4sFhczktFUF` | |
| **a real stale fill, attempted** | `3JKAnmbAnQKM141iT3fd4Pk2jhTLjBmmYC3Gk4vp6Zyc` | quote banked for 326 s against a 300 s bound. `REFUSED QuoteTooOld`; the USDT was refunded and neither escrow nor credit moved |
| a fake-token fill, attempted | `BBrcmc6uqzrY4Dko1ary9Zn6VoiYBCY4tbxHwDSnNXAn` | `ft_on_transfer` called directly, no token involved — refused |
| clearing v2's state before migrating | `CgDwCdzXorSHj7SZPr517TEPnSadA2bBuigdwc8BZkUh`, `8Q5hgyfAn6Mc57rhqZuoocJ8URQ3zQYUrfDT1pzuujZR`, `GbGqDdGJ5b4o6ZxPsez4xdZZmJLDVuGkgNkstimzzHhA` | cancel → withdraw → reap, so the v3 migration stranded nothing |

The v2 receipt, straight off the chain:

```
EVENT_JSON:{"standard":"hallmark","version":"1.0.0","event":"filled",
  "data":[{"mandate_id":"1","filler":"d3bc151a…b7bd484",
           "amount_in":"100000000000000000000000","delivered":"424919",
           "cost_bps":105,"ceiling_bps":300}]}
```

0.1 wNEAR sold for 0.424919 USDT at a **realised all-in cost of 105 bps**
against a ceiling of 300, proven against NEAR Intents' own signature, with the
output in the vault before the input was credited to anyone. The round trip
closed to the token: balances before the mandate and after both withdrawals were
identical (0.130000 wNEAR, 0.518409 USDT) and every credit zero, because the
owner and the filler were the same account — the honest v1 case of §6.1.

And the keyless proof surface answers on v3 today:

```
quote_signer()                                ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc
mandate_count() / open_mandate_count()        1 / 1
storage_cost_estimate()                       0.01024 NEAR   <- a recommendation, not a price
is_signed(worst.quote.json)                   true
quote_age_secs(worst.quote.json)              179116   (2.07 days)
worst_cost(worst.quote.json)                  10000 bps
realised_cost(worst, at full fill)              503 bps   <- 500 bps of unread appFees, priced
dry_check(worst, 300 s age bound)             REFUSED QuoteTooOld { … max_age_secs: 300 }
dry_check(worst, 30 d age bound, 30 bps)      REFUSED CostCeilingBreached { worst_bps: 10000, ceiling_bps: 30 }
```

---

## §4 System architecture

```
  OWNER                                                      FILLER (anyone)
    │                                                             │
    │ 1. ft_transfer_call(origin token → vault)                    │
    │    msg = the mandate terms                                   │
    ▼                                                              │
┌──────────────────────────────────────────────┐                    │
│  hallmark.near          (the vault)          │  2. read open mandates
│                                              │◄───────────────────┤
│  mandates : IterableMap<u64, MandateRecord>  │     (keyless view)
│  credits  : LookupMap<(AccountId,Token),u128>│                    │
│                                              │  3. POST /v0/quote
│                                              │     public, no JWT,
│                                              │     recipient = <the filler>
│                                              │     ↳ source the output
│                                              │       however it likes
│                                              │                    │
│  4. ft_on_transfer(sender, amount, msg)      │◄───────────────────┤
│     ── ONE synchronous call, no promises ──  │  ft_transfer_call(
│     ├─ predecessor == destination token?     │    destination token → vault,
│     ├─ sha256(canonical bytes)               │    amount, msg={quote,sig,id})
│     ├─ ed25519_verify  ──────────────────────┼── 1Click signer (hardcoded)
│     ├─ from_slice(the SAME bytes)            │                    │
│     ├─ amount ≥ signed minAmountOut?         │                    │
│     ├─ cost_bps(quote, amount) ≤ ceiling?    │                    │
│     ├─ assets / recipient / size / deadlines │                    │
│     ├─ credit OWNER  += amount               │                    │
│     └─ credit FILLER += quote.amountIn       │                    │
│                                              │                    │
│  5. withdraw(token)                          │◄──────── either party
└──────────────────────────────────────────────┘
```

No oracle. No keeper. No cron. No indexer. No server. No promise chain in the
critical path. Steps 1, 4 and 5 are contract calls; step 3 is a public HTTP
request made by whoever wants to fill.

### 4.1 Why there is no promise chain

`ft_on_transfer` is the whole verification. It is synchronous, it returns the
unused amount (`"0"` — the vault consumes all of it), and it mutates only its own
state. There is no cross-contract call to fail halfway, so there is no rollback
path, no in-flight record, and no stuck state.

Payouts are **pull, not push**: both parties call `withdraw`. That keeps the
verification path free of promises entirely, and means a counterparty that is not
storage-registered on a token cannot brick a fill.

### 4.2 Components

| component | language | role |
|---|---|---|
| `contract/` | Rust / near-sdk **=5.24.1** (§3.14) | the vault: verify, bound, credit |
| `contract/src/quote.rs` | Rust | the signed subset, the invariant, the arithmetic |
| `contract/src/mandate.rs` | Rust | the mandate, the typed refusals, `check` |
| `client/src/lib/` | TypeScript | canonicalisation (`json-stable-stringify`), 1Click, the vault client |
| `client/src/bin/bound.ts` | TypeScript | what a live quote actually guarantees. No key, no funds |
| `client/src/bin/post.ts` | TypeScript | the owner: prepay storage, post a mandate |
| `client/src/bin/fill.ts` | TypeScript | the reference filler: read mandates → quote → deliver |
| `client/src/fillers/edge.ts` | TypeScript | an independent filler, written from §2.1 and §5.3 alone |
| `client/src/fillers/adapted.ts` | TypeScript | NEAR's own official Intents agent, pointed at a vault (§6.2) |
| `client/src/fillers/race.ts` | TypeScript | all three price one mandate; cross-checks the arithmetic three ways |
| `frontend/` | React 19 + Vite, 8 routes | the site — see §4.3b |
| `frontend/src/lib/hallmark.ts` | TypeScript | the shared runtime: keyless view calls, canonicalisation, transaction builders |
| `frontend/src/lib/post.ts`, `fill.ts` | TypeScript | opening an agreement, and filling one |
| `frontend/tools/mkfixtures.py` | Python | generates `fixtures.json` from `contract/fixtures/` so no signed quote is ever hand-typed |
| `frontend/tools/check.py` | Python | checks the app's factual claims against the code and the live chain |
| `test-token/` | Rust | NEP-141 + full NEP-145, so a payout can be made to fail on purpose |

> **Correction kept.** This table previously named `near-sdk 5.30` (contradicting
> §3.14 four pages earlier), a `filler/` and `filler-adapted/` that do not
> exist, and `web/` as Next.js. Both 1Click and NEAR RPC answer with
> `Access-Control-Allow-Origin: *`, so the page talks to the real API and the
> real chain from the browser with nothing in between — which is still true of
> the app that replaced it.
>
> **And this decision was later reversed.** The site was hand-written with no
> framework, for the reason argued in §4.3b, and on **2026-11-04** it was
> replaced by a React build and `web/` was deleted. What that bought and what it
> cost is recorded in §4.3b rather than quietly dropped.

### 4.3b The site

**Eight routes**, a React 19 + Vite application in `frontend/`.

| route | for | carries |
|---|---|---|
| `/` | everyone, first | the exploit as an artifact, the invariant, FINRA 26-15, the live vault |
| `/book` | the user, and the judge | the live register, every figure a keyless view call |
| `/mandate/:id` | **the user, and the judge** | one agreement: its terms as written on chain, its performance, a live quote priced at both delivery sizes — and the fill |
| `/post`, `/account/:id` | the owner | open an agreement; manage a position |
| `/verify` | the sceptic | paste any quote; the contract rules on it |
| `/how` | the engineer, the auditor, an agent developer | three figures, each folded over the whole clause |
| `/limits` | everyone | §2.9 and §14 in full, unhedged |

> **This replaced a hand-written site, and the trade is worth stating.** `web/`
> was four static pages with no framework, no build step and no bundler, and
> three of the four loaded no third-party code at all. The argument for it was
> that a project whose pitch is *"we removed the things you have to trust"*
> should not ask a reader to trust a dependency graph to see the claim — a judge
> could read the whole page.
>
> That property is gone, and nothing replaces it: the app is a bundle, and
> reading it is not the same as reading the source. **What is unchanged is the
> part the claim actually rests on** — the app still computes almost nothing,
> every figure is still a keyless view call to `hallmarkfi.near`, and the
> canonicaliser is still cross-checked against two independent implementations
> that have no framework at all (§5.1). The thing a reader must trust to
> *verify* Hallmark was never the page; it is the contract, and that is
> unchanged.
>
> What the bundle bought: per-agreement pages, a fill flow with a confirm
> dialog that re-reads the chain before it asks for a signature, and one
> implementation instead of two drifting copies of the same runtime.

> **It was seven pages, and that was one page per thing I wanted to say rather
> than one per thing a reader wanted to do.** `proof.html`, `exploit.html`,
> `mechanism.html`, `contract.html` and `fillers.html` were merged or absorbed.
> Two of them had independently grown their own copy of the order-book renderer,
> which is the clearest possible signal that the thing they were both reaching
> for — *let me actually use this* — deserved a page of its own instead of a
> paragraph on each of theirs.

**The discipline the site inherits from the contract.** It computes almost
nothing: canonicalisation, and that is all. Every number — every cost, every
verdict, every balance — is a keyless view call to `hallmarkfi.near`, so there
is no figure on any page the page could have invented, and no server between the
reader and the chain. Both dependencies are health-checked separately and
independently, because the chain and the venue fail independently.

#### The app page, and the one place a dependency was unavoidable

`app.html` is the product: the live book, a real fill priced against a real
mandate, posting a mandate, and managing a position. Three of those four read the
chain and nothing else — **keyless, no wallet, no permission from anyone**,
including looking up another account's position. A judge can use most of the page
without owning a NEAR account.

Posting and filling cannot work that way, and the reason is worth stating
precisely because it is a *property of NEAR's permission model, not a gap in it*.
A **function-call access key** may only sign calls that (a) target the one
contract it was granted for and (b) attach a **zero** deposit. Prepaying storage
is a call to the vault **with** a deposit. The escrow transfer is a call to the
**token** contract — not the vault — with one yoctoNEAR. Both conditions are
violated, in opposite directions, by design. **So there is no key this page could
hold that would let it transact for a user**, which is exactly the right
guarantee: a web page cannot be handed a key that quietly moves someone's funds.
Signing therefore needs a full-access signature, which needs a wallet, which
needs a wallet library.

That library is confined to `frontend/src/wallet/`, and the selector is
**not constructed at all until the reader clicks connect**. Two candidates were
tested in a real browser from a plain ES-module page with no build step:

| candidate | result |
|---|---|
| `@hot-labs/near-connect` | one self-contained 61 KB module, but its wallet manifest resolves to **one individual's personal GitHub repository**. Rejected: at demo time the ability to connect would depend on a third party's repo being up and unmodified — the precise species of unaudited trust this project exists to remove |
| `@near-wallet-selector` 8.10.2 | NEAR's own library. Heavier import graph, needs its own stylesheet. **Built a selector in 71 ms** in headless Chrome. Chosen |

**And every action renders the exact transaction and the exact `near` command
that performs it, from the same builder that the button signs.** This is the part
that matters. There is deliberately only one description of each action in the
codebase — `txOpen`, `txFill`, `txWithdraw`, `txCancel`, `txReap` — so the
command a reader copies *cannot drift* from the transaction the button sends. A
reader who would rather not connect a wallet to a hackathon project, which is the
correct instinct, can read the bytes and run it themselves. The wallet is a
convenience over that, never a substitute for it, and the page is usable with the
wallet library entirely unreachable.

The visual grammar follows from the same idea: **a read is plain and a write is
boxed.** Every spending action sits in an `.act` block tagged `writes`, names the
account that would sign, and carries its transaction underneath. Nothing on the
page can move funds it has not first shown you.

**White paper, black ink, green strands.** The page is a document, so it is
white by default — unconditionally, not "unless your machine prefers dark".
Dark is on the toggle and is remembered, but it is never chosen for you.

The green is **NEAR's own `#00EC97`**, and it appears in *two forms*, because
one form cannot do both jobs:

| token | value | role |
|---|---|---|
| `--ok-bright` | `#00EC97` | fills, strands, the mark, the live dot. **Never text** — 1.56:1 on white |
| `--ok` | `#007A51` | green *text*: "yes — valid", ALLOWED. 5.38:1 |

Black on `#00EC97` is **12.54:1**, which is why the bright one is a fill and the
darker one is a letterform. The strands are what give the page its identity: a
green rule running out of every section heading, the edge of every note, the
fill of the one button that matters.

Red (`#C0362C`) is refusal. Nothing else is ever coloured — not a heading, not
a link, not a logo for its own sake. Emphasis is weight, never hue, which is
what `.hi` exists for.

> **Correction kept, twice.** The prose beside the cost bar described the
> ceiling marker as "the gold notch", then "the white notch", and each time the
> palette moved it became wrong again. It now says "the notch". **Prose should
> not name a colour it does not control.**
>
> **Correction kept.** The first palette was brass on near-black, reasoning
> that a hallmark is the assay stamp punched into precious metal. The metaphor
> was good and the result was wrong: gold read as ornament on a page about
> arithmetic, and — worse — it was used for *emphasis*, so **`503 bps`, the
> cost of the malicious fixture honoured in full, rendered in the same colour
> as "verified".** A bad number wearing the good colour is a design that lies.
> Under the rule above it is red, and every one of the seventeen accent uses
> was re-classified as verdict, emphasis, or affordance.

Three rules were set before any markup was written, and each one caught
something:

1. **Every animation must explain; none may decorate.** The fill sequence exists
   to show that the output is in the vault *before* the input is credited; the
   bound bar exists to show a ceiling being crossed. There are no gradients in
   motion, no particles and no parallax, and everything is suppressed under
   `prefers-reduced-motion`.
2. **No signed quote is ever hand-typed.** The first draft transcribed
   `worst.quote.json` into the markup and got two things wrong —
   `amountInFormatted` as `"10"` instead of `"10.0"`, one byte, and the signature
   entirely. The page would have shown `is_signed: false` on a genuinely signed
   quote, i.e. been wrong about the one thing it exists to demonstrate.
   `mkfixtures.py` now derives them, and `--check` fails if they drift.
3. **No widget may fake its result.** A first version of the freshness slider
   moved a fictional "now" while quietly varying `max_quote_age_secs` behind the
   reader's back to force a refusal. It was replaced with the control an owner
   actually has — the age bound itself — so the crossover happens exactly where
   the fixture's real age falls. Verified against the chain at seven points.

**And the live calls had to survive the chain's own rate limiter.** The public
NEAR RPC sits behind Cloudflare and throttles bursts; a page firing a dozen
parallel view calls trips it, and the browser reports that as a bare
`Failed to fetch` with no status — which reads like the chain is down when it is
not. Several pages showed exactly that. Every call now goes through a queue that
bounds concurrency to three, retries with backoff, fails over across
`free.rpc.fastnear.com`, `rpc.mainnet.near.org` and `near.drpc.org`, and caches
identical reads for eight seconds. All three answer
`Access-Control-Allow-Origin: *`, so none of it needs a server.

`check.py` holds the site to the same standard as the specification: it extracts
the method count, the refusal count and the test counts from the source, reads
the staked balance and the signer off mainnet, and fails if the site disagrees.
It has already caught one: the landing page said *eight* typed refusals when
there are nine.

### 4.3 The canonicaliser exists three times, on purpose

Canonical form is the one place where an error is silent: a canonicaliser that
drifts produces bytes the venue never signed, and every fill fails for a reason
no log explains. There is no Rust implementation at all (§2.6), but there are
three independent *producers* of canonical bytes:

| where | implementation | used by |
|---|---|---|
| `fixtures/mkfix.py` | Python, `json.dumps(sort_keys=True)` + from-scratch RFC-8032 ed25519 | generating and re-verifying the fixtures |
| `client/src/lib/canonical.ts` | TypeScript, `json-stable-stringify` | the CLIs and the reference filler |
| `frontend/src/lib/hallmark.ts` | TypeScript, hand-written stable stringify | the app |

All three agree, byte for byte and hash for hash, on all three fixtures:

```
honest   692 bytes  8no2rMSjesYe97Jhi6RWKxRvvYsYARBVQZXtMDMyhvwp
worst    690 bytes  FTTFigJiyLLbx9Um6FC17P8UvRwfuSA1DRMDeNZvTj33
sandbox  681 bytes  5TV8CQDmjsTexoYFKLvT6rwdVzGqcJ13tnBcx1eyqdZB
```

Three independent implementations agreeing is meaningfully stronger evidence
than one being carefully written.

---

## §5 The contract

### 5.1 `Mandate` — what the owner commits to

Four numbers and two assets. No policy language, no allowlist, no per-protocol
configuration.

```rust
pub struct Mandate {
    pub origin_asset: String,         // nep141:…
    pub destination_asset: String,
    pub recipient: String,            // the signed `recipient` a quote must name
    pub max_cost_bps: u32,            // the whole point
    pub max_fill: U128,               // largest single fill, origin base units
    pub max_quote_age_secs: u32,      // how stale a quote may be — §2.10
    pub expiry_ns: U64,               // u64 as a JSON string, so a client
}                                     //   cannot silently lose precision
```

A reader who knows nothing about Intents can audit this in ten seconds. That is
deliberate: a bound nobody can read is a bound nobody trusts.

`open` refuses eight kinds of terms that could never be enforced, each with its
own message, all eight covered by `open_refuses_terms_that_could_not_be_enforced`:

| refused | why |
|---|---|
| `origin_asset == destination_asset` | one token would match both the funding path and the delivery path, so `Fill` could be satisfied with the very asset being sold |
| `destination_asset` not a `nep141:` id | credits are paid out via `token_account()`, which only understands nep141 ids; rejecting here keeps `withdraw` total |
| `max_cost_bps > 10_000` | a ceiling above 100% bounds nothing |
| `max_fill == 0` | nothing could ever fill |
| `max_quote_age_secs == 0` | nothing could ever fill |
| `max_quote_age_secs > 30 days` | a ceiling priced in month-old USD marks bounds nothing (§2.10) |
| `expiry_ns` already past | nothing could ever fill |
| `recipient != this vault` | the quote would pay someone else and delivery could not be verified |

### 5.2 `SignedQuote` — only what the signature covers

```rust
#[serde(rename_all = "camelCase")]
pub struct SignedQuote {
    pub amount_in: String,
    pub amount_in_usd: String,
    pub amount_out_usd: String,
    pub amount_out: String,
    pub min_amount_out: String,
    pub origin_asset: String,
    pub destination_asset: String,
    pub recipient: String,
    pub deadline: String,          // caller-chosen; bounds nothing on its own
    pub timestamp: String,         // when the venue signed. The freshness bound
    pub slippage_tolerance: u32,   //   is enforced against THIS — §2.10
}
```

`appFees` and `depositAddress` are absent by construction.

### 5.3 `check` — the whole verifier

```rust
pub fn check(
    canonical: &[u8],
    signature: &[u8; 64],
    m: &Mandate,
    delivered: u128,
    now_ns: u64,
) -> Result<Accepted, Refusal> {
    let digest  = env::sha256_array(canonical);
    let message = bs58::encode(digest).into_string();
    if !env::ed25519_verify(signature, message.as_bytes(), &signer_pk()) {
        return Err(Refusal::BadSignature);
    }
    let q: SignedQuote = serde_json::from_slice(canonical)?;   // the SAME bytes

    if q.origin_asset != m.origin_asset
        || q.destination_asset != m.destination_asset { return Err(Refusal::WrongAsset) }
    if q.recipient != m.recipient                     { return Err(Refusal::WrongRecipient) }
    if now_ns >= m.expiry_ns                          { return Err(Refusal::MandateExpired) }

    let now_secs      = now_ns / 1_000_000_000;
    let deadline_secs = parse_iso8601_secs(&q.deadline);
    if now_secs >= deadline_secs {
        return Err(Refusal::QuoteExpired { deadline_secs, now_secs });
    }

    // The bound is denominated in USD marks that were true when the venue
    // signed. `deadline` is chosen by whoever asked for the quote, so only the
    // signed `timestamp` can bound how stale those marks are — §2.10.
    let signed_at_secs = parse_iso8601_secs(&q.timestamp);
    if now_secs > signed_at_secs + m.max_quote_age_secs as u64 {
        return Err(Refusal::QuoteTooOld { signed_at_secs, now_secs,
                                          max_age_secs: m.max_quote_age_secs });
    }

    let amount_in: u128 = q.amount_in.parse().expect("bad amountIn");
    if amount_in > m.max_fill.0 { return Err(Refusal::FillTooLarge { amount_in,
                                             max_fill: m.max_fill.0 }) }

    let floor: u128 = q.min_amount_out.parse().expect("bad minAmountOut");
    if delivered < floor { return Err(Refusal::UnderDelivered { delivered, floor }) }

    let cost = cost_bps(&q, delivered);
    if cost > m.max_cost_bps {
        return Err(Refusal::CostCeilingBreached { worst_bps: cost, ceiling_bps: m.max_cost_bps });
    }
    Ok(Accepted { cost_bps: cost, amount_in })
}
```

Typed refusals, so a judge can tell *why* without reading a log:

```rust
pub enum Refusal {
    BadSignature,
    CostCeilingBreached { worst_bps: u32, ceiling_bps: u32 },
    UnderDelivered      { delivered: u128, floor: u128 },
    WrongAsset,
    WrongRecipient,
    FillTooLarge        { amount_in: u128, max_fill: u128 },
    QuoteExpired        { deadline_secs: u64, now_secs: u64 },
    QuoteTooOld         { signed_at_secs: u64, now_secs: u64, max_age_secs: u32 },
    MandateExpired,
}
```

Every variant is constructed by a named test in §12. There are no decorative
error cases.

### 5.4 The deadline parser

The signed `deadline` is an ISO-8601 string, so it must be parsed in the
contract — the string is what the venue signed, and a client-supplied integer
alongside it would be unsigned and therefore worthless.

`parse_iso8601_secs` accepts exactly `YYYY-MM-DDTHH:MM:SSZ` and
`YYYY-MM-DDTHH:MM:SS.sssZ`, validates every separator and range, and **panics on
anything else**. A `deadline` is a security boundary; guessing at a malformed one
is worse than refusing. Date arithmetic uses Howard Hinnant's `days_from_civil`,
integer-only, no `chrono` dependency.

Pinned by `iso8601_parsing_is_exact` (including the 2024-02-29 leap-year case,
the classic off-by-one-day bug) and
`a_malformed_deadline_panics_rather_than_being_guessed_at`.

### 5.5 Storage

```rust
#[near(contract_state)]
pub struct Hallmark {
    mandates:        IterableMap<u64, MandateRecord>,
    open_ids:        IterableSet<u64>,                      // the order book — §2.12
    credits:         LookupMap<(AccountId, String), U128>,  // (who, token) → claimable
    storage_balance: LookupMap<AccountId, U128>,            // prepaid, per account
    next_id:         u64,
}

pub struct MandateRecord {
    owner:     AccountId,
    terms:     Mandate,
    escrow:    U128,   // remaining origin base units
    delivered: U128,   // destination base units credited so far
    fills:     u32,
    worst_bps: u32,    // worst realised cost across this mandate's fills
    open:      bool,
}
```

Measured, not estimated: a record is **296 bytes**, an open-id index entry
**~190**, a credit slot **145**, and a prepaid-storage row **74**. Every one of
those is charged to whoever caused it (§2.11).

`IterableMap` for mandates because fillers must enumerate them; `LookupMap` for
credits because nobody needs to iterate those and iteration is what makes NEAR
collections expensive.

### 5.6 The exported surface

Checked against `contract/src/lib.rs`; nothing is exported that is not listed.

| method | kind | purpose |
|---|---|---|
| `new` | init | once, at deploy |
| `migrate` | **private** init | supersede v1's state in place; see §2.10. Only the account itself can call it, and the full-access key is deleted after (§10.2) |
| `storage_deposit(account_id?)` | call, payable | prepay for the state you will create (§2.11) |
| `storage_withdraw(amount?)` | call, payable | take back what no mandate is using |
| `ft_on_transfer` | call | **the only path that moves value.** NEP-141 calls it; `msg` carries the action |
| `withdraw(asset)` | call, payable | pull a credited balance; pull-not-push by design (§4.1) |
| `resolve_withdraw` | private | restores the credit if the payout failed; returns the slot's storage if it did not |
| `resolve_storage_withdraw` | private | restores a prepaid balance if paying it out failed |
| `cancel(mandate_id)` | call | owner only; credits the unspent escrow back. Keeps the record and its storage |
| `reap(mandate_id)` | call | owner only, closed mandates only; deletes the record and refunds the storage it frees (§2.11) |
| `get_mandates(from_index, limit)` | **view** | the order book — open mandates only |
| `get_mandate(mandate_id)` | **view** | one record, open or closed |
| `get_credit(account_id, asset)` | **view** | what an account can withdraw |
| `mandate_count()` | **view** | how many have ever been opened; ids are never reused |
| `open_mandate_count()` | **view** | the length of the order book (§2.12) |
| `storage_balance_of(account_id)` | **view** | prepaid storage |
| `storage_cost_estimate()` | **view** | what `open` will charge, before paying it |
| `quote_age_secs(canonical)` | **view** | how old the venue's signature is, as the chain sees it (§2.10) |
| `worst_cost(canonical)` | **view** | the bound, for anyone, free |
| `realised_cost(canonical, delivered)` | **view** | what the owner would actually pay |
| `is_signed(canonical, signature)` | **view** | did NEAR Intents really sign these bytes? |
| `dry_check(canonical, signature, terms, delivered)` | **view** | allowed or refused, and why |
| `quote_signer()` | **view** | the key the contract trusts |

Twenty-three methods exported in total, and nothing exported that is not in the
table above — checked by extracting every `pub fn` from the `#[near] impl` and diffing
it against this section.

`ft_on_transfer`'s `msg` is a tagged enum, and **which variant is legal depends
on which token arrived** — the contract checks that, so an action cannot be
performed with the wrong asset:

| `action` | legal token | effect |
|---|---|---|
| `open` | the mandate's **origin** asset | create a funded mandate |
| `fund` | that mandate's **origin** asset | top up the escrow |
| `fill` | that mandate's **destination** asset | the transfer *is* the delivery |

The **twelve** view methods are the proof surface: **every guarantee in this
document can be exercised with no key, no funds and no deposit**, which
`the_view_methods_answer_without_a_key` demonstrates against a live node.

Two of them are deliberately *arithmetic only* and do **not** check the
signature: `worst_cost` and `realised_cost` price whatever bytes they are
handed. That is what makes them useful on a quote you are still deciding about,
and it is why `dry_check` — which does verify — is the one a filler consults
before spending anything. The proof page calls `is_signed` alongside them for
exactly this reason.

### 5.7 Gas

**Mainnet, measured on the v2 live fill: 30.25 TGas** (v1 measured 29.85; the
freshness check costs one extra ISO-8601 parse) across every receipt in
the transaction — the filler's `ft_transfer_call`, the token's hop, the
verification, and both credits. Against a 300 TGas limit that is 10%.

The sandbox figure below counts only the fill transaction's own burn, which is
why it is smaller; both are real, they measure different brackets.

**Sandbox: 7.8 TGas for an entire fill**, end to end — the filler's
`ft_transfer_call`, the token's hop, `sha256` + `ed25519_verify` over the signed
bytes, the invariant, and both credits. Against a 300 TGas limit that is 2.6%.

The verification path makes no cross-contract calls (§4.1), so there is nothing
in it that scales with anything but the length of the signed quote.
`an_owner_funds_a_mandate_a_stranger_fills_it_and_both_withdraw` asserts
`< 100 TGas`, so a regression shows up as a failing test.

---

## §6 The filler — where the agents come from

The honest answer, in five parts.

### §6.1 On day one the filler is the owner's own agent, and the mandate still does all of its work

Hallmark's guarantee is not "someone will trade for me"; it is
"I need not trust whoever does." One owner and one agent is already a complete
product. No network is required for the mechanism to be sound (§1.5).

### §6.2 The demonstrated supply side is three fillers, and no more is claimed

They are deliberately not three copies of each other:

| | strategy | written from | what it proves |
|---|---|---|---|
| `bin/fill.ts` | splits the spread — delivers halfway between the venue's floor and its expected fill | the architecture | the reference. Asks the contract for a verdict before spending anything |
| `fillers/edge.ts` | **patient**: fills only when the spread it keeps clears a floor it sets itself, and computes the cost itself instead of asking the contract | **§2.1 and §5.3 alone**, without reading `fill.ts` | an independent implementation of the invariant. It prints its own number beside the contract's on every live quote, so the agreement is checkable rather than asserted — and it exits non-zero if they ever differ |
| `fillers/adapted.ts` | the official NEAR Intents agent flow, pointed at a vault | `near/agent-skills`, skill `near-intents` | what a stranger's agent must change to become a filler. The diff is the claim |

`npm run race` has all three price the same live mandate side by side, and
cross-checks the arithmetic three ways — the reference client, the independent
implementation, and the contract itself.

> **Correction kept — the artifact to adapt is not what this section called
> it.** Earlier drafts said "NEAR's own official DeFi starter prompt". Searched
> for on 2026-11-02: no such starter agent or prompt exists. What does exist is
> **`github.com/near/agent-skills`**, whose `near-intents` skill is NEAR's
> official agent-facing material for 1Click — a `SKILL.md` plus `rules/*.md`,
> installed with
> `npx skills add near/agent-skills --skill near-intents`. Eight skills are
> published there (`near-intents`, `near-api-js`, `near-cli-rs`,
> `near-contract-audit`, `near-dapp`, `near-kit`, `near-smart-contracts`,
> `near-ai-cloud`).
>
> That is a better anchor than a prompt, and it sharpens the point: the skill
> teaches an agent the flow `/v0/tokens → /v0/quote (dry) → /v0/quote (wet) →
> deposit tx → /v0/deposit/submit → /v0/status`. **A Hallmark filler is that
> flow with the deposit step pointed at a vault instead of a `depositAddress`,
> plus reading open mandates.**

**Built: `client/src/fillers/adapted.ts`.** It is `rules/server-example.md`'s
`executeSwap` with four changes and nothing else, marked `[1]`..`[4]` in the
source:

| # | the official agent | a Hallmark filler | why |
|---|---|---|---|
| 1 | is **told** what to swap | reads `get_mandates()` — a keyless view — and takes the pair, size and ceiling from the mandate | the work comes from the chain |
| 2 | `recipient` is the agent | `recipient` is the **vault** | `recipient` is inside the signature, so a quote addressed elsewhere is refused `WrongRecipient` |
| 3 | `dry: false`, then sends the **origin** asset to `quote.depositAddress` | `dry: true`, then sends the **destination** asset to the vault with the signed quote in `msg` | **the load-bearing one.** `depositAddress` is unsigned (§2.4), so a filler should not trust it and the vault must not |
| 4 | `submitDeposit` then `pollStatus` until `SUCCESS \| FAILED \| REFUNDED` | neither — the fill settles inside `ft_on_transfer`, so the receipt *is* the terminal state | nothing to poll, and nothing in flight |

Unchanged: the API base, the quote request shape, `slippageTolerance`, asset ids
from `/v0/tokens`, and reading `amountOut` / `minAmountOut` off a signed quote.
An agent that already speaks 1Click keeps all of it.

**And one change that is not an adaptation at all — a `[0]` fix to the official
example, because it does not run.** `rules/server-example.md`'s `getQuote` sends
only `dry`, `swapType`, `slippageTolerance` and its five parameters. Against the
live API on 2026-11-02 that is **HTTP 400**:

```
depositType should not be empty … refundType should not be empty …
recipientType should not be empty … deadline must be a valid ISO 8601 date string
```

`rules/api-quote.md` documents all four with defaults — `ORIGIN_CHAIN`,
`DESTINATION_CHAIN`, `ORIGIN_CHAIN`, `~10 min` — which is presumably why the
example omits them. The network requires them. This is §0's rule arriving in
NEAR's own material: **where the documentation disagrees with the network, the
network wins**, and the disagreement gets recorded. `adapted.ts` sends all four
explicitly, marked `[0]` to keep it separate from the four Hallmark changes.

That this was found by *running* the official example rather than reading it is
the same discipline that found §2.10 and §2.11 — and it is worth noting that an
agent following the skill verbatim would fail its first quote.

One thing the adaptation exposes that is worth saying out loud: **the official
flow uses 1Click as an execution venue; a filler uses it as a price oracle whose
word can be proved.** Same API, opposite direction of trust.

> **Correction kept.** An earlier claim said any official-prompt agent becomes a
> filler "by changing one line." That is false. The diff above is four changes
> across roughly 40 lines — plus a reason to care.

> **Correction kept.** An earlier claim said any official-prompt agent becomes a
> filler "by changing one line." That is false. It is roughly **20 lines** — read
> open mandates, obtain a quote, source the output, deliver — plus a reason to
> care.

### §6.3 Growth runs on two incentives, and the second works at zero volume

Short
term, the spread (§2.5). Long term, every fill emits a receipt bound to the
filler's account, so a filler accumulates a **provable** execution record rather
than a self-reported one. A new agent developer wants fills in order to build a
track record they can later sell. The receipt already exists; indexing it by
filler costs almost nothing.

### §6.4 The capital requirement is real and is the price of §2.4

A filler must
front the output. Two ways to do it, both legitimate:

- **Inventory.** Hold the destination asset and quote against it. Lowest
  latency, highest capital.
- **Source-then-deliver.** Buy the output via 1Click (`depositType: INTENTS`,
  ~10 s, §3.6), then deliver it into the vault. Two transactions, and the filler
  carries the price risk in between — which is exactly the risk it is being paid
  the spread to carry.

### §6.5 What is not claimed

There is no live filler ecosystem, and this spec does not pretend otherwise.

---

## §7 User flows

### 7.1 The owner

```
0. storage_deposit(storage_cost_estimate())    # once, ~0.0154 NEAR, reusable
1. choose a pair, a ceiling, a max fill, a max quote age, an expiry
2. ft_transfer_call the ORIGIN asset into the vault, msg = the mandate terms
3. walk away
4. withdraw(destination) as fills arrive;  cancel(id) to recover unspent escrow
```

Step 0 is the same `storage_deposit` every NEP-141 token already asks for before
it will hold a balance for you, and `cancel` gives it back, so it is paid once
rather than per mandate (§2.11). `post.ts` does it and skips it when the balance
already covers the next one. After that the owner commits once and never signs
again.

### 7.2 The filler

```
1. get_mandates()                       # a keyless view call
2. POST /v0/quote   recipient = <the mandate's recipient>
3. source the output (inventory, or 1Click, or anywhere else)
4. ft_transfer_call the DESTINATION asset into the vault
   msg = { mandate_id, canonical, signature }
5. withdraw(origin)
```

Step 4 either succeeds completely or refuses completely. There is no partial
state and nothing to unwind.

### 7.3 The judge

```
1. git clone && cargo test                           # 58 tests, no network, no key
2. cat fixtures/worst.quote.json                     # a validly signed 99.99% haircut
3. near view hallmarkfi.near worst_cost     '{...}'  # 10000 bps
4. near view hallmarkfi.near realised_cost  '{...}'  # 503 bps even at the full fill
5. near view hallmarkfi.near quote_age_secs '{...}'  # how stale those marks are
6. near view hallmarkfi.near dry_check      '{...}'  # REFUSED, and which refusal
7. near view hallmarkfi.near get_mandates   '{}'     # a real open mandate, right now
```

Step 1 needs no network and no funds. Steps 3–7 need no key. Or open the proof
page, which makes all of them a click and computes none of them itself.

---

## §8 The arithmetic

### 8.1 Rounding has exactly one safe direction

Every truncation must make the reported cost **larger**, never smaller — a bound
that understates cost is not a bound.

| step | rounding | effect on reported cost |
|---|---|---|
| `parse_fixed(amountOutUsd)` | down | understates output value → cost **up** ✓ |
| `value_ratio = outUsd·1e9/inUsd` | down | cost **up** ✓ |
| `fill_ratio = delivered·1e9/amountOut` | down | cost **up** ✓ |
| `kept = value·fill/1e9` | down | cost **up** ✓ |
| `bps = shortfall/1e9` | **must round UP** | ← the one that needed fixing |

The final division was truncating. On the honest fixture the exact cost is
**159.348 bps**; truncation reported **159**, understating the bound. It now uses
`div_ceil` and reports **160**. Pinned by
`the_reported_cost_is_never_below_the_true_cost`, which asserts both
`reported ≥ exact` and `reported − exact < 1.0`.

**This was found by running the code, not by reasoning about it.** It is the
reason the spike existed before the architecture was finalised.

### 8.2 256-bit intermediates are not optional

wNEAR has **24 decimals**. A $1M order is ~1e30 base units, and
`delivered × 1e9` is ~1e39, which overflows `u128` (max ≈ 3.4e38).

`mul_div(a, b, c)` therefore computes `a·b` as a 256-bit `(hi, lo)` pair and
performs restoring long division, 128 iterations. `RATIO = 1e9` gives 1e-9
resolution — five orders of magnitude finer than one basis point.

The final `shortfall` step needs no 256-bit path: `(1e9 − kept) × 10_000 ≤ 1e13`.

### 8.3 Worked, on the real fixtures

```
honest, at its floor      1 − (9.935599388160 × 2195590043365775454985587
                                              / 2217767720571490358571300) / 9.995520000000
                        = 159.347994 bps   → contract reports 160

honest, at expected fill  1 − 9.935599388160 / 9.995520000000
                        =  59.947 bps      → contract reports  60

worst, at its floor       1 − (9.496481598073 ×  214367530430548360111
                                              / 2143675304305483601119090) / 9.999220000000
                        = 9999.050278 bps  → contract reports 10000

worst, at expected fill   1 − 9.496481598073 / 9.999220000000
                        = 502.78 bps       → contract reports 503  ← the 500 bps appFee
```

The last line is the proof of §2.3: the contract never reads `appFees` and
prices it exactly.

---

### 8.4 The quotient has to fit, and for three versions nobody checked

Restoring division is only correct while its answer fits in the register it is
accumulated into. `mul_div` computed a 256-bit product and divided it by a
128-bit `c` without ever asking whether the quotient fit in 128 bits. It did not
say so and it did not fail; it returned a number.

Worse, it returned **the wrong number in the unsafe direction**. An overflowing
quotient lands on `u128::MAX`, which makes `kept >= RATIO`, which makes
`cost_bps` return **0** — and a cost of zero clears every ceiling. The one
function the whole bound rests on failed *open*.

Two things hid it. `wrapping_sub` is load-bearing for the division, so
`overflow-checks = true` (which covers every other arithmetic operation in the
contract) is deliberately silenced exactly here. And the test that existed was
honest about its own scope in its name:
`mul_div_does_not_overflow_at_realistic_magnitudes`.

It was found by transliterating `mul_div` into Python and comparing it against
exact bignum arithmetic rather than by reading it:

| regime | cases | result |
|---|---|---|
| quotient fits in 128 bits | 167,246 random | **0 mismatches** — the implementation is exactly right |
| quotient does not fit | 20,000 random | **20,000 returned `u128::MAX`, no panic** |

The fix is the precondition itself, `require!(hi < c)`, which over 300,000
random cases admits every quotient that fits and rejects every one that does
not — **0 false positives, 0 false negatives**. A fill that panics is refunded
by NEP-141; a fill priced from a wrong number is not.

**Reachability, stated honestly: it is not reachable with any quote 1Click
would sign.** Triggering it needs `amountOutUsd / amountInUsd ≈ 3.4e29`, or a
delivery that same factor above `amountOut`. This was a latent fault in the
arithmetic, not a live hole — fixed because the ceiling is the product, and
"the venue would never sign that" is an assumption, not a bound.

Live on mainnet since v3.1, and provable without a key, because `realised_cost`
takes the canonical bytes and checks no signature:

```
near view hallmarkfi.near realised_cost \
  '{"canonical":"{…\"amountOut\":\"1\"…}","delivered":"170141183460469231731687303715884105728"}'

v3    0                                        ← accepted at any price
v3.1  HostError(GuestPanic { panic_msg: "mul_div overflow" })
```

## §9 Failure modes

| what fails | what happens | why that is right |
|---|---|---|
| filler delivers a tampered quote | `BadSignature`, before any field is read | §2.6 |
| filler delivers against a quote past its deadline | `QuoteExpired{deadline, now}` | — |
| filler banks a signed quote and exercises it later | `QuoteTooOld{signed_at, now, max_age}` | the **venue** writes `timestamp`; the filler writes `deadline` (§2.10) |
| stranger opens mandates to burn the vault's storage | *"prepay storage first"* | whoever creates state pays for it (§2.11) |
| stranger tops up someone else's mandate | *"only the owner can fund a mandate"* | a gift with no mechanism behind it |
| owner funds a mandate that has already expired | *"mandate has expired"* | nothing could ever fill it |
| a token's `ft_transfer` needs more than 10 TGas | the withdrawal fails and the credit is restored | 30 TGas is now forwarded; unused gas is refunded |
| a signature that decodes to fewer than 64 bytes | `BadSignature`, never zero-padded | a verifier must not guess at a length |
| **a refused fill** | the *outer* `ft_transfer_call` **succeeds** and the delivery is refunded; the refusal is in an inner receipt | NEP-141 catching the panic is what makes the refund work. Anything reporting on a fill must read `receipts_outcome` — `receiptFailure()` in `client/src/lib/hallmark.ts` — or it will call a refused fill a filled one, which the reference filler did |
| filler delivers less than the signed floor | `UnderDelivered{delivered, floor}` | §2.4 |
| realised cost breaches the ceiling | `CostCeilingBreached{worst, ceiling}` | §2.1 |
| quote names a recipient that is not the mandate's | `WrongRecipient` | recipient is signed |
| quote is for a different pair | `WrongAsset` | both assets are signed |
| fill exceeds the mandate's size | `FillTooLarge{amount_in, max_fill}` | — |
| mandate has expired | `MandateExpired` | — |
| `appFees` inflate the cost | priced into the ceiling automatically | §2.3, §8.3 |
| USD marks absent | panics `quote has no usable mark` | §3.13 |
| malformed `deadline` | panics | §5.4 |
| 1Click returns no quote | nothing to verify, nothing approved | fails closed for free |
| 1Click rotates its signer key | every fill refused until the key is updated | fails closed, not open |
| filler not storage-registered on the origin token | `withdraw` fails for the filler only | pull-not-push, §4.1 |
| two fillers race the same mandate | both verified independently; escrow bounds the total | no attribution ambiguity, §2.4 |

The pattern: **every failure refuses, and every refusal is typed.** There is no
path in which uncertainty results in a transfer.

---

## §10 Threat model

| adversary | capability | outcome |
|---|---|---|
| prompt-injected owner's agent | can deliver against any quote it can obtain | bounded by the ceiling; the primary case (§1.5) |
| malicious filler | any `slippageTolerance`, any `appFees`, any route | `worst.quote.json` *is* this, and it is refused |
| malicious filler nominating its own deposit address | — | **impossible**: the vault never sends to a filler-nominated address (§2.4) |
| filler claiming another's delivery | — | **impossible**: the amount is a function argument, not a balance delta (§2.4) |
| malicious filler + stolen agent key | unlimited delivery attempts | each is bounded; worst case is repeated ceiling-cost fills, capped by `max_fill` and escrow |
| filler banking free signed quotes as options on the escrow | 1Click signs a 10-year deadline on a free `dry: true` quote | **closed by §2.10.** v1 was exposed to this and it was the worst defect in the project |
| griefer with no stake, buying the vault's storage with gas | ~10 cents to stop every write | **closed by §2.11** |
| 1Click, signing a terrible quote | — | refused; its own signature is the evidence |
| 1Click, refusing to sign | — | liveness loss, never a funds loss |
| 1Click signer key compromised | can mint arbitrarily bad signed quotes | **unmitigated.** §10.1 |
| us, the deployer | no admin key, no pause, no upgrade path | nobody to switch it off |

### 10.1 The honest hole

If 1Click's signing key is stolen, the attacker can mint quotes with any terms,
and Hallmark will accept any that fit the ceiling. The guarantee degrades from
*cryptographic* to *the ceiling the owner signed* — which still caps the loss at
`max_cost_bps` of `max_fill` per fill rather than the whole escrow, but the
crypto is gone.

This is not fixable from inside the design. It is stated rather than buried.

### 10.2 Immutability is a deployment step, not a sentence

"Nobody to switch it off" is only true if it is executed. After the final
deploy, **delete the full-access key** so the contract cannot be upgraded or
paused by anyone, including us. Step 7 in §13.

Two costs, both accepted and both stated:

1. **A bug found later cannot be patched**, only superseded by a new deployment
   that owners migrate to voluntarily.
2. **The storage lock becomes permanent.** An account with no full-access key
   cannot be deleted, and deleting the account is the only way to release the
   0.00001 NEAR/byte that NEAR locks against the contract's code — 2.36 NEAR for
   this contract. Immutability and recoverability are the same key; you cannot
   keep both.

Because the cost is identical whenever it is paid, the key is deleted **last**,
immediately before submission, so the build retains the ability to fix a bug for
as long as possible. Until then the README states that the key exists.

---

## §11 Invariants

Each one names what enforces it and what checks it.

| # | invariant | enforced by | checked by |
|---|---|---|---|
| 1 | No token is credited out unless `check()` returned `Ok` | the `Err` arm of `fill` panics before either `credit` call | `a_ceiling_the_fill_cannot_meet_refuses_and_refunds_the_filler` |
| 2 | `reported_cost_bps ≥ true_cost_bps`, always (§8.1) | `div_ceil` on the final division | `the_reported_cost_is_never_below_the_true_cost` |
| 3 | The bytes hashed and the bytes parsed are the same bytes (§2.6) | `is_signed_by_venue(canonical)` then `from_slice(canonical)` | `every_single_byte_is_covered_by_the_signature` |
| 4 | No method reads a field outside §3.2's signed set | `SignedQuote` has only signed fields, so reading another is a compile error | audited: no unsigned field name appears in contract code, only in comments saying it is not read |
| 5 | The verification path makes no cross-contract calls (§4.1) | every `ext_ft::ext`, `Self::ext` and `Promise::new` in the contract is inside `withdraw` or `storage_withdraw`, never in `ft_on_transfer` | audited by enclosing function — three call sites, all in the two payout methods |
| 6 | The output is in the vault before the input is credited to anyone (§2.4) | `delivered` is an `ft_on_transfer` argument, so the transfer already happened | `an_owner_funds_a_mandate_a_stranger_fills_it_and_both_withdraw` |
| 7 | A mandate can never credit out more origin asset than its escrow | `require!(amount_in <= rec.escrow.0)` | `a_fill_beyond_the_escrow_is_refused` |
| 8 | Realised cost, filler spread included, never exceeds `max_cost_bps` (§2.5) | `cost_bps(&q, delivered) > m.max_cost_bps` refuses | `delivering_above_the_floor_lowers_the_owners_realised_cost` |
| 9 | No admin key, no pause, no upgrade path (§10.2) | there is no such method; immutability itself is a deploy step | audited: no `owner_id`, `admin`, `pause`, `upgrade` or `migrate` anywhere |
| 10 | A failed payout restores the credit rather than burning it | `resolve_withdraw` re-adds on `Err` | `a_failed_transfer_restores_the_credit` |
| 11 | An action cannot be performed with the wrong token | `open`/`fund` require the origin asset, `fill` the destination asset | `a_fill_in_the_wrong_token_is_refused` |
| 12 | The USD marks a cost is computed from are no older than the owner allowed (§2.10) | `now_secs > signed_at + max_quote_age_secs` refuses, against the **signed** `timestamp` | `the_freshness_bound_is_exact_to_the_second`, `a_quote_older_than_the_mandate_allows_is_refused_on_chain` |
| 13 | No field the counterparty chooses is ever used as a bound | `depositAddress` unread (§2.4); `deadline` is a deadline, never a freshness test (§2.10) | audited: `deadline` is compared only against itself; `max_quote_age_secs` is compared against `timestamp` |
| 14 | The vault never stakes NEAR for state anyone else created (§2.11) | every path that writes state ends in `settle_storage`, which charges the caller the **measured** growth | `the_vault_never_pays_for_state_someone_else_created`, `a_filler_pays_for_the_state_its_fill_creates`, `a_storage_deposit_pays_for_its_own_ledger_entry` |
| 15 | The vault's storage is always covered by a prepayment that has not been refunded | `withdraw` removes the credit slot; `cancel` refunds nothing; `reap` refunds only the **measured** bytes freed, capped at what was paid | `a_withdrawal_releases_the_storage_it_was_using`, `the_vault_never_pays_for_state_someone_else_created`, `reaping_returns_only_the_storage_it_actually_frees` |
| 16 | A signature is 64 bytes or it is refused | `decode_signature` returns `None` on any other length | `a_signature_is_sixty_four_bytes_or_nothing` |

---

## §12 Test plan

**Done — 30 of 30 passing, `cargo test`, no network, no key, ~0.19s:**

| test | asserts |
|---|---|
| `signer_key_matches_the_published_one` | the hardcoded key is the published one |
| `verifies_a_live_signature_inside_the_vm` | hash-then-parse against a real 1Click signature |
| `verifies_the_malicious_signature_too` | the 99.99% quote is genuinely signed |
| `every_single_byte_is_covered_by_the_signature` | all **692** bytes flipped, each rejected |
| `honest_quote_costs_what_the_api_implies` | 160 bps at the floor |
| `malicious_quote_is_a_9999_bps_haircut_and_is_validly_signed` | 10000 bps, `slippageTolerance == 9999` |
| `the_reported_cost_is_never_below_the_true_cost` | rounding direction (§8.1) |
| `delivering_above_the_floor_lowers_the_owners_realised_cost` | 160 bps → 60 bps; `UnderDelivered` below the floor |
| `the_malicious_quote_is_refused_at_its_floor_but_fine_at_its_expected_fill` | 503 bps — the unread `appFees`, priced |
| `mandate_refuses_the_malicious_quote_and_says_why` | typed `CostCeilingBreached` |
| `mandate_accepts_an_in_bound_quote` | accepts at 200, refuses at 100 |
| `a_forged_quote_is_refused_before_any_field_is_read` | signature checked first |
| `an_expired_quote_is_refused_even_though_it_is_validly_signed` | `QuoteExpired`, deadline `1795132800` |
| `an_expired_mandate_is_refused` | `MandateExpired` |
| `a_fill_larger_than_the_mandate_allows_is_refused` | `FillTooLarge` |
| `iso8601_parsing_is_exact` | 5 cases incl. the 2024-02-29 leap year |
| `a_malformed_deadline_panics_rather_than_being_guessed_at` | `should_panic` |
| `mul_div_does_not_overflow_at_realistic_magnitudes` | $1M of a 24-decimal token |
| `parse_fixed_truncates_toward_a_worse_cost` | fixed-point parsing |
| `a_quote_for_the_wrong_pair_is_refused` | `WrongAsset` |
| `a_quote_routed_to_someone_else_is_refused` | `WrongRecipient` |
| `a_stale_quote_is_refused_even_though_it_is_signed_and_inside_its_deadline` | **the §2.10 hole**: signed, in-deadline, refused |
| `the_freshness_bound_is_exact_to_the_second` | allowed at the bound, refused one second past it |
| `the_signing_time_is_covered_by_the_signature` | `timestamp` cannot be edited after signing |
| `the_age_bound_has_to_be_set_and_has_to_be_sane` | a mandate with no age bound refuses everything |
| `a_date_that_does_not_exist_is_refused` | `days_in_month`, incl. the 100- and 400-year rules |
| `the_31st_of_february_is_not_guessed_at` | `should_panic` — used to parse as 3 March |
| `the_31st_of_april_is_not_guessed_at` | `should_panic` |
| `a_thirteenth_month_is_refused` | `should_panic` |
| `a_signature_is_sixty_four_bytes_or_nothing` | short, long, empty and non-base58 all refused, never zero-padded |

**Done — 28 of 28 passing, `cargo test --test integration`, against a real
sandbox node driven by a real NEAR Intents signature:**

The fixture `fixtures/sandbox.quote.json` is a genuine signed 1Click quote for
5 wNEAR → ETH with `recipient: hallmark.near`. Every account it names is a
*named* NEAR account, so the sandbox can stand up the exact accounts the
signature commits to — `wrap.near`, `eth.bridge.near`, `hallmark.near`. Nothing
is mocked: real NEP-141s (with the full NEP-145 storage surface), real
`ft_transfer_call`s, and the real `ed25519_verify` host function. (The mainnet
USDC fixture cannot be used this way: its asset is a 64-hex implicit account
whose key nobody has.)

| test | asserts |
|---|---|
| `an_owner_funds_a_mandate_a_stranger_fills_it_and_both_withdraw` | the whole product: fund, fill at 69 bps realised, both sides withdraw real tokens, 7.8 TGas |
| `a_ceiling_the_fill_cannot_meet_refuses_and_refunds_the_filler` | typed `CostCeilingBreached` on-chain, **and the filler loses nothing** |
| `delivering_under_the_signed_floor_is_refused` | `UnderDelivered` in the real runtime |
| `open_refuses_terms_that_could_not_be_enforced` | all **six** `open` guards (§5.1), and that none of them creates a mandate |
| `a_fill_in_the_wrong_token_is_refused` | the origin asset cannot be delivered as if it were the output |
| `a_mandate_can_be_topped_up_and_the_extra_is_fillable` | `fund` doubles the escrow and supports two fills |
| `a_fill_beyond_the_escrow_is_refused` | escrow is a hard ceiling; no double credit on the refused fill |
| `a_closed_mandate_cannot_be_funded` | a cancelled mandate takes no more money |
| `withdrawal_is_single_use_and_guarded` | missing 1 yoctoNEAR, nothing-to-withdraw, and the second withdrawal all refuse |
| `a_failed_transfer_restores_the_credit` | an unregistered payee cannot burn a balance |
| `the_view_methods_answer_without_a_key` | the keyless proof surface, incl. `is_signed` rejecting a tampered quote and `dry_check` returning each verdict |
| `get_mandates_lists_only_open_ones` | the order book drops cancelled mandates; unknown ids return `null` |
| `cancel_after_a_fill_returns_only_the_remainder` | cancelling returns unspent escrow and leaves settled fills alone |
| `an_owner_can_cancel_and_recover_the_unspent_escrow` | escrow returns; a closed mandate cannot be filled |
| `a_stranger_cannot_cancel_a_mandate` | owner-only authority |
| `a_quote_older_than_the_mandate_allows_is_refused_on_chain` | **§2.10** in a real runtime: `QuoteTooOld`, filler loses nothing, escrow untouched |
| `fixture_is_still_fresh_enough_to_fill` | says in one line if the captured fixture has aged out, instead of making you read fifteen failures |
| `opening_a_mandate_has_to_be_paid_for` | **§2.11**: no prepayment ⇒ refused and refunded; prepay ⇒ works, and the prepayment is spent exactly |
| `a_withdrawal_releases_the_storage_it_was_using` | the credit slot is removed, not zeroed |
| `the_vault_never_pays_for_state_someone_else_created` | **the §2.11 invariant**: over three open+cancel cycles, what the owner was charged equals what the vault grew by, as an equality. Both earlier versions of the fix failed this |
| `a_filler_pays_for_the_state_its_fill_creates` | an unknown filler with no prepayment is refused and refunded; with one, it is charged precisely what its fill created |
| `funding_a_mandate_creates_no_state_and_is_charged_nothing` | `fund` writes nothing new, so it costs nothing |
| `a_storage_deposit_pays_for_its_own_ledger_entry` | the deposit covers its own row — 74 bytes, measured |
| `reaping_returns_only_the_storage_it_actually_frees` | `cancel` settles the net delta and keeps the record; `reap` returns exactly the bytes freed; a reaped mandate is gone; reaping twice refuses |
| `reap_is_owner_only_and_needs_a_closed_mandate` | authority, and ordering |
| `the_order_book_tracks_what_is_open_not_what_ever_existed` | **§2.12**: eight opened, seven closed, one reaped — the index and the records never disagree, ids are never reused, and pagination runs off the index in id order |
| `unused_prepaid_storage_can_be_taken_back` | `storage_withdraw`, and that `open` then refuses |
| `only_the_owner_can_fund_and_only_a_live_mandate` | a stranger's top-up is refused and refunded; an expired mandate takes no money |

Account creation note: `registrar` can only create dot-free top-level accounts,
and `near` exists in genesis with a key nobody holds, so `wrap.near` cannot be
created the ordinary way. The tests use the sandbox's `patch` to write each
account into state with a known key.

**The suite is deterministic, and that took two fixes.** Each integration test
starts a real nearcore node, and at cargo's default parallelism 23 of them race
for ports until one dies inside `PeerManagerActor::spawn`; `.cargo/config.toml`
therefore pins `RUST_TEST_THREADS = "4"`. Separately, a `patch`ed account's
state lands before the node has indexed its access key, so an immediate call
fails with *"access key … has never been observed"* — `account()` now polls
`view_access_key` until it is actually queryable. Both failures were
intermittent, and both were found by running the suite repeatedly rather than
once. **"Clone it and run the tests" is the whole claim; a suite that fails one
run in three does not support it.**

**Also run by hand against mainnet, 2026-11-02, and worth automating:**

| probe | result |
|---|---|
| call `ft_on_transfer` **directly**, with no token involved at all | refused — *"this token is not the mandate's destination asset"*. The asset id is derived from `env::predecessor_account_id()`, so a caller can only ever claim to be itself. tx `BBrcmc6uqzrY4Dko1ary9Zn6VoiYBCY4tbxHwDSnNXAn` |
| bank a signed quote, wait past the mandate's 300 s bound, then fill for real | refused on-chain with `QuoteTooOld`; the USDT came back and neither the escrow nor the filler's credit moved |
| how far out 1Click will sign a `deadline` | **3,650 days**, on a free `dry: true` quote (§2.10) |

**Still to add:**

- The two-fillers-race-one-mandate case.
- Fuzz `cost_bps` against a Python `Decimal` oracle over random quotes and
  delivery amounts, asserting `reported ≥ exact` on every sample.
- One live-quote test behind a feature flag: fetch a real `dry: true` quote and
  verify it, so **signer-key rotation is caught by CI rather than by a judge.**
  The two probes above belong in the same place.

---

## §13 Build order

| # | task | gate |
|---|---|---|
| 0 | **done** — verifier, 30 unit tests, wasm builds | ✓ 2026-11-01 |
| 1 | **done** — vault state + `ft_on_transfer` for the **origin** token | ✓ |
| 2 | **done** — `ft_on_transfer` for the **destination** token + `credits` | ✓ |
| 3 | **done** — `withdraw`, `cancel`, `get_mandates` | ✓ |
| 4 | **done** — `near-workspaces` end-to-end, 28 tests; gas recorded in §5.7 | ✓ |
| 5 | **done** — TypeScript client: canonicaliser (54 assertions), 1Click, vault | ✓ |
| 6 | **done** — `bound`, `post`, and **three** fillers: the reference, one written from §2.1 alone, and one adapted from `near/agent-skills` with the diff shown. `npm run race` prices one mandate with all three (§6.2) | ✓ |
| 7 | **done** — deployed to mainnet as `hallmarkfi.near`; v2 redeployed after the audit. Full-access key **still present**, deliberately (§10.2, and §2.10 is the reason) | ◐ |
| 8 | **done** — real mainnet fill, end to end, twice: v1 at 115 bps and v2 at 105 bps (§3.17) | ✓ |
| 9 | **done** — proof page, static, every figure a live view call | ✓ |
| 10 | **done** — README rewritten as "do X — see Y" steps, every number re-measured | ✓ |
| 11 | **done** — full line-by-line audit of contract + client against this file; §2.10 and §2.11 found and closed; v2 redeployed and re-exercised on mainnet | ✓ 2026-11-02 |
| 12 | **done** — §2.11 re-done as exact accounting, §2.12 order-book index, three fillers; v3 redeployed and re-exercised on mainnet | ✓ 2026-11-02 |

**What is actually left:** step 7's key deletion, which is a one-way door. The
decision taken is to delete it **after the winners are announced**, i.e. after
2026-11-20 — not before judging, because §2.10 is the standing argument for
keeping the ability to fix a bug found in something already live. Everything
else in this table is done and verified on mainnet.

**On deferring the ~$5 mainnet fill:** it was first priority while `appFees` was
the compensation rail. §3.8 settled the fee question from live state at zero
cost, and §2.5 removed the dependency entirely. What step 8 still verifies is a
real end-to-end fill, which cannot be tested before steps 1–3 exist. Until then
the end-to-end claim is **UNVERIFIED** and appears nowhere public.

---

## §14 Open items and known limits

**UNVERIFIED:**

1. That a filler sourcing via `depositType: INTENTS` can deliver into the vault
   within the quote's deadline in practice. ~10 s estimated (§3.6); not timed by
   us end to end. Not load-bearing: the reference filler holds inventory
   instead, which is the documented v1 (§6.4).

*Resolved:* gas (§5.7), the sandbox fund → fill → withdraw path (§12), and
**the mainnet round trip (§3.17)**.

**Found by the line-by-line audit of 2026-11-01, and closed:**

2. **The stale-quote hole (§2.10).** v1 bounded quote age by the signed
   `deadline`, which the *filler* chooses and 1Click signs ten years out for
   free. A filler could bank free signed quotes as options on the owner's
   escrow. Closed with `max_quote_age_secs` against the signed `timestamp`.
   This was the most serious defect in the project and it was live on mainnet.
3. **The vault paid for strangers' state (§2.11).** ~10× leverage; about ten
   cents of gas to stop every write on a live vault. Closed with prepaid
   storage, and `withdraw` now releases its credit slot.

Smaller, same audit: `post.ts` could not open a mandate at all (it sent
`expiry_ns` as a string against a `u64`, now `U64` everywhere); `fund` accepted
top-ups from strangers and on expired mandates; `withdraw` forwarded only 10
TGas, enough for the tokens tested and not for an arbitrary one; a signature
decoding to fewer than 64 bytes was silently zero-padded; `2026-02-31` parsed as
3 March; the TypeScript fixed-point parser accepted `".5"` where Rust panics;
and the test suite failed roughly one run in three for two unrelated sandbox
races (§12).

**ASSUMPTION:**

4. That the $154.91 in the 1Click fee account arrived *as app fees* (§3.8).
   Balance proves accrual, not causation.
5. That 1Click's signed `amountInUsd` / `amountOutUsd` marks are honest. The
   whole bound is denominated in them. If 1Click marks dishonestly, the bound is
   wrong — but it is *their own signature*, which is why this is the weakest
   assumption we are willing to make and why §10.1 exists.

**Known limits, stated rather than hidden:**

6. **One sub-cent transfer between participants is not attributed** (§2.11, end):
   a fill charges the filler for the owner's credit slot, and the owner is
   credited ~0.00145 NEAR for releasing it. Never a loss to the vault, and it
   cannot be farmed, because every such transfer requires a real delivery.
7. **First-come-first-served means the filler delivers near the floor.** The
   owner gets their ceiling, not the best price available.

   **The next version is a sealed-bid auction, and it must not be the obvious
   one.** The obvious design — collect deliveries for N blocks and settle the
   best — would have the vault holding N fillers' tokens and returning N−1 of
   them. That is a custody window of exactly N blocks, and it is the twelfth
   design in §2.8 that does not survive "**not a custodian, ever**". An earlier
   draft of this document published it as the roadmap in three places; it was
   caught by reading §14.7 against §2.9 rather than by anything failing.

   **What survives: bid, then deliver.** A filler commits
   `H = sha256(mandate_id ‖ min_delivery ‖ nonce)` — a hash, no tokens. After
   the window closes each bidder reveals `(min_delivery, nonce)`; the contract
   keeps the largest revealed delivery and grants that filler an exclusive
   right to fill for a further K blocks, at or above the amount they named.
   Everybody else delivered nothing, so there is nothing to return, and
   **nothing was ever held**. The custody window is zero, §2.4's ordering is
   unchanged, and the winner is still verified against the venue's signature
   exactly as today.

   **Its own costs, stated.** A winner who never delivers costs the owner K
   blocks of latency; the mandate then reopens to the next revealed bid. Bonding
   the bid would fix that and is rejected for the same reason the obvious design
   is — a bond is custody. A bidder who never reveals is simply dropped. And
   two rounds mean two transactions before any token moves, which is strictly
   worse than today's one for the common case of a single filler; the auction is
   therefore opt-in per mandate, not the default.
8. **1Click signer-key compromise is unmitigated** (§10.1).
9. **No independent price benchmark exists** (§3.12). A bound, never best
   execution.
10. **Liveness depends on 1Click.** If the API stops signing, Hallmark stops
   filling. It never stops *refusing*, which is the safe direction.

   > **Observed, not theorised.** On 2026-11-02 the 1Click API returned
   > **HTTP 521** (a Cloudflare "origin down") for an extended period —
   > `/v0/tokens` and `/v0/quote` both. During the outage: no quote could be
   > obtained, so **no fill could happen**; and every keyless view on
   > `hallmarkfi.near` kept answering, so the vault kept *refusing* exactly as
   > it would have anyway. The failure mode is the documented one.
   >
   > It also found a real gap on our side: `post.ts` resolved asset symbols
   > through `/v0/tokens`, so **posting a mandate — which needs nothing from
   > 1Click at all — failed with the outage.** Depending on a venue to learn
   > that wNEAR has 24 decimals is a bug. `nearAsset` now takes a full
   > `nep141:…` id with no network call, and falls back to reading `ft_metadata`
   > off the token contract itself. Mandate #1 on v3 was posted during the
   > outage to prove it.
11. **The filler needs capital** (§6.4). This is the deliberate cost of closing
    the `depositAddress` hole.
12. **Three fillers, all written by us or adapted by us** — there is no
    third-party filler ecosystem and none is claimed (§6.2, point 5). What the
    three do demonstrate is that the mandate does not care who fills it, and
    that an independent reading of §2.1 agrees with the contract on live quotes.
13. **Immutable means unpatchable** (§10.2) — and §2.10 is the argument for
    deleting that key as late as possible. An audit found a critical bug in a
    contract that was already live; had the key been gone, it could not have
    been fixed.
14. **Mainnet only.** No Intents testnet exists or is planned. Dev accounts,
    tiny amounts, `dry: true` quotes wherever possible.

---

## §15 Positioning

The one section allowed to be prose, because it exists to be copied into the
README, the landing page and the submission. Every factual claim in it is
sourced to a section above.

### 15.1 The essence, in one paragraph

> A not-held order hands your broker discretion over the time and price of your
> trade. For a century the only thing protecting you was a promise — the best
> execution obligation. In July 2026 FINRA opened a docket asking whether that
> promise still protects anyone, worried that it gets applied in blanket fashion
> and re-labelled in transit. Both worries are the same: your protection lives
> in prose somebody else drafted. NEAR Intents signs the economics of every
> fill, so on NEAR the promise can be replaced with arithmetic. Hallmark is a
> not-held order whose protection is a number the venue signed itself, checked
> on-chain, that nobody can redefine because nobody holds the pen.

### 15.2 The landing page, in the order it should read

1. **The headline.** *A not-held order that enforces its own execution bound.*
2. **The exploit, immediately.** A validly signed NEAR Intents quote that
   guarantees a 99.99% loss while every amount field looks healthy — and the
   `cargo test` line that proves it. Lead with the artifact, not the argument.
3. **The one invariant**, as the single expression in §2.1, with the words "no
   oracle, no price feed, no RPC call" beside it.
4. **Why the promise needs replacing.** FINRA 26-15 §7, dated, with both
   concerns quoted (§1.2). This is the paragraph that answers "is this problem
   real".
5. **What the contract refuses**, as the typed refusal list (§5.3). Concrete,
   not adjectival. `QuoteTooOld` belongs on this list and is worth a sentence of
   its own: a correct signature is **not** sufficient, because the quote's
   deadline is written by the counterparty (§2.10).
6. **Try it yourself** — the four keyless view calls from §7.3.
7. **What this is not** (§2.9), in full and unhedged. Stating the limits is the
   most credible thing on the page.
8. **The bug we shipped and then found.** §2.10, as a short section with the
   two mainnet `dry_check` lines one day apart — `ALLOWED at 60 bps` against v1,
   `REFUSED QuoteTooOld` against v2. A project that audits itself in public and
   shows the diff is more believable than one that claims it was right first
   time, and this is the only section on the page that proves the discipline in
   §0 is real rather than stated.

### 15.3 The three sentences for a founder judge

- *The not-held order is a century old and its only protection is a legal
  promise; FINRA has an open docket on whether that promise means anything.*
- *NEAR Intents signs the economics of every fill, so the promise can be
  arithmetic instead — and that arithmetic needs no oracle, which is why it
  works across 38 chains when every comparable system is stuck on one.*
- *The proof is a validly signed quote that guarantees a 99.99% loss and passes
  every spend cap and allowlist shipped today, including the one MetaMask
  released three days ago.*
- *And the thing I would want a reviewer to check first: we audited our own
  live contract, found that a filler could bank free signed quotes as options on
  the owner's escrow, and closed it with a field that was already inside the
  signature — both states are reproducible on mainnet with one keyless call.*

### 15.4 What success looks like, honestly

Not a billion-dollar company — a product with real usage.

The near-term test is whether anyone delegates a real order to a mandate they
did not write, and whether a filler they do not know fills it inside the bound.
That is a small number of people doing a real thing, and it is the only number
worth watching first.

The larger shape, stated as a thesis and not a projection: if delegated machine
execution becomes ordinary, something has to bound it, and the thing that bounds
it is positioned to become the standard rather than an implementation. FINRA
asking about **safe harbors** is the tell — a provable bound is what a safe
harbor looks like when it is engineered instead of legislated. Revenue, at 1Click's
own 20 bps anchor against $4.80B a month (§3.15), is a real business long before
it is a large one. We are not claiming the large one.

### 15.5 Tracks

`defi` primary — *"deep liquidity, no custodian, nobody to switch it off"*:
liquidity is whatever a filler can source including all of Intents; no custodian
because the fill is atomic and nobody ever holds a counterparty's funds (§2.4);
nobody to switch it off because the full-access key is deleted (§10.2).

Then `security`, `business`, `open`. Not `agents`, not `realworld`, not
`privacy`, not `thesis`.

---

## §16 Sources

**Every transaction hash in this document was re-checked on 2026-11-02** against
`api.nearblocks.io` and, for the ones older than its 50-transaction window,
against `archival-rpc.mainnet.near.org`: **16 of 16 on-chain.** The two other
base58 strings of that shape — `8no2rMSjesYe97Jhi6RWKxRvvYsYARBVQZXtMDMyhvwp`
and `FTTFigJiyLLbx9Um6FC17P8UvRwfuSA1DRMDeNZvTj33` — are the fixtures' **quote
hashes** (§3.3), not transactions, and are labelled as such.

> Worth noting for anyone re-running this: the public `rpc.mainnet.near.org`
> prunes `tx` lookups, and both it and the archival endpoint rate-limit hard
> enough that a loop over 18 hashes reports false negatives. The same hash came
> back "on-chain" and "not found" minutes apart. One nearblocks request for the
> account's transaction list is both faster and more reliable than 36 RPC calls.

**Verified by us, 2026-11-01, reproducible from this repo**

- `fixtures/mkfix.py` — canonicalisation + from-scratch RFC-8032 ed25519
- `contract/src/lib.rs` — the vault; `src/tests.rs` 30 tests, `tests/integration.rs` 23
- `fixtures/honest.quote.json`, `fixtures/worst.quote.json` — signed captures

**Live endpoints and accounts**

- `https://1click.chaindefuser.com` — `/v0/tokens`, `/v0/quote`, `/v0/orders`
- `https://rpc.mainnet.near.org` — `intents.near`, USDC
  `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`
- 1Click quote signer `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`
- 1Click fee recipient `5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd`

**Source read, not merely cited**

- 1Click SDK `dist/index.mjs` — signature coverage, `appFees: void 0` at :1617
- `near-sdk` **5.24.1** `env.rs` — `ed25519_verify` :773, `ecrecover` gated at :707 (§3.14b).
  An earlier draft of this list cited 5.30.0 and its line numbers; 5.30 cannot
  produce a contract this VM will run, so it is the wrong source to cite

**Regulatory**

- FINRA Regulatory Notice **26-15**, issued 2026-07-24, comments closed
  2026-09-25 — §7: not-held orders, blanket designations, Rule 5310 safe harbors
- SEC Regulation NMS proposal, 2026-06-11 — rescinding Rule 611
- FIX `ExecInst` tag 18: `1 — Not held`, `5 — Held`

**Prior art**

- arXiv 2601.04583 — *Autonomous Agents on Blockchains: Standards, Execution*
- `up2itnow0822/agent-wallet-sdk` PR #98 (2026-10-25) — off-chain SDK floor
- `Nostidus4/TreasuryPilot` PR #542 — allowlisted-signer EIP-712 quotes
- `harishkotra/envelope` — reserve-derived mandate
- ERC-8377 (draft) — reference-relative slippage bounds
