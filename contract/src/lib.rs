//! Hallmark — a not-held order that enforces its own execution bound.
//!
//! An owner funds a mandate naming a pair, a worst acceptable all-in cost, a
//! maximum fill, a maximum quote age and an expiry. Anyone may fill it. The
//! filler delivers the output **first**, and the vault verifies that delivery
//! against NEAR Intents' own signature before crediting the filler with the
//! input.
//!
//! Delivering first is the load-bearing decision, not a detail. A quote's
//! `depositAddress` is not covered by the venue's signature, so any design where
//! the vault sends the owner's funds to an address the filler nominated can
//! simply be robbed. Inverting the order of operations also means the delivered
//! amount arrives as a function argument rather than a balance delta, so
//! concurrent fills cannot be confused for one another and nobody is ever
//! holding a counterparty's funds. See ARCHITECTURE.md §2.4.

pub mod mandate;
pub mod quote;

pub use mandate::{check, Accepted, Mandate, Refusal};
pub use quote::{cost_bps, is_signed_by_venue, worst_cost_bps, SignedQuote, QUOTE_SIGNER};

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, serde_json, AccountId, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

/// A NEP-141 `ft_transfer` is cheap, but the destination asset is whatever the
/// owner named, and a token with a heavier transfer must not be able to strand a
/// credit permanently. Unused gas is refunded, so there is no cost to headroom.
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[ext_contract(ext_ft)]
#[allow(dead_code)] // the macro generates `ext_ft`; the trait itself is only its shape
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// A funded mandate and everything it has done.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct MandateRecord {
    pub owner: AccountId,
    pub terms: Mandate,
    /// unspent origin asset, in base units
    pub escrow: U128,
    /// destination asset delivered into this mandate so far
    pub delivered: U128,
    pub fills: u32,
    /// the worst realised cost any fill against this mandate has incurred, in
    /// bps. By construction this can never exceed `terms.max_cost_bps`.
    pub worst_bps: u32,
    pub open: bool,
}

/// What a caller asks for when they send tokens in. Which variants are legal
/// depends on which token arrived, and the contract checks that.
#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum Action {
    /// Open a new mandate, funded by the origin asset just transferred in.
    Open { terms: Mandate },
    /// Add more origin asset to an existing mandate.
    Fund { mandate_id: u64 },
    /// Fill a mandate: this transfer *is* the delivery.
    Fill { mandate_id: u64, canonical: String, signature: String },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Hallmark {
    mandates: IterableMap<u64, MandateRecord>,
    /// The ids of the mandates that are still open.
    ///
    /// Without this, `get_mandates` walks every mandate ever created and throws
    /// away the closed ones, so the only way a filler can find work gets
    /// steadily more expensive as the vault succeeds and eventually exceeds a
    /// view call's gas budget. This makes the order book cost what it holds
    /// rather than what the vault remembers (ARCHITECTURE.md §2.12).
    open_ids: IterableSet<u64>,
    /// (who, asset id) -> withdrawable balance. Payouts are pull, not push, so
    /// a counterparty who is not storage-registered on a token cannot brick a
    /// fill for anyone else.
    credits: LookupMap<(AccountId, String), U128>,
    /// Prepaid NEAR, per account, against the state that account creates.
    /// Without this the vault pays for every mandate anyone opens, and a
    /// stranger can burn the vault's balance roughly ten times faster than
    /// their own — see ARCHITECTURE.md §2.11.
    storage_balance: LookupMap<AccountId, U128>,
    next_id: u64,
}

#[near]
impl Hallmark {
    #[init]
    pub fn new() -> Self {
        Self {
            // v3 prefixes, one byte each.
            //
            // Adding a field to a borsh struct means old records cannot be read
            // back, so each version gets its own namespace rather than
            // misreading the previous one's bytes. v1 used `m`/`c`; v2 added
            // `max_quote_age_secs` to `Mandate` (§2.10) and used `M`/`C`/`S`;
            // v3 dropped the `storage_paid` field that exact accounting makes
            // unnecessary (§2.11) and added the open-id index (§2.12).
            mandates: IterableMap::new(b"n"),
            open_ids: IterableSet::new(b"p"),
            credits: LookupMap::new(b"d"),
            storage_balance: LookupMap::new(b"t"),
            next_id: 1,
        }
    }

    /// Replace the previous version's state wholesale.
    ///
    /// There is no admin key and no upgrade path once the full-access key is
    /// gone (§10.2); this exists only so a deployment can be superseded in place
    /// while that key is still held, and it is `#[private]` so nobody but the
    /// account itself can call it. It has been used twice: v1 → v2 and v2 → v3,
    /// both times because an audit found something in a contract that was
    /// already live.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        Self::new()
    }

    // --------------------------------------------------------------- storage

    /// Prepay for the state you are about to create. One deposit covers many
    /// mandates and many fills; whatever is left can be withdrawn.
    ///
    /// The deposit pays for its own ledger entry, so that entry is the one piece
    /// of state in the contract nobody else subsidises either.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> U128 {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a deposit");

        let before = env::storage_usage();
        let current = self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0);
        self.storage_balance.insert(who.clone(), U128(current + amount));
        self.storage_balance.flush();
        let entry_cost = bytes_to_near(env::storage_usage().saturating_sub(before));
        require!(amount > entry_cost, "deposit does not cover its own ledger entry");

        // The entry exists now, so rewriting it does not grow state again.
        let credited = current + amount - entry_cost;
        self.storage_balance.insert(who, U128(credited));
        U128(credited)
    }

    /// Charge `who` for whatever state this call created, or credit them for
    /// whatever it released.
    ///
    /// **One rule, applied at the end of every path that mutates state: whoever
    /// causes a byte to be written pays for that byte.** Nothing is estimated
    /// and nothing is rounded up into an allowance — the figure is the measured
    /// difference in `env::storage_usage()`, so the vault's own balance can
    /// never be consumed by state a third party created (ARCHITECTURE.md §2.11).
    ///
    /// `store` collections buffer their writes and flush when the call ends, so
    /// every collection this contract touches is flushed first. Without that,
    /// the measurement reads the state as it was before the call and the charge
    /// comes out as zero.
    fn settle_storage(&mut self, who: &AccountId, before: u64) {
        self.mandates.flush();
        self.open_ids.flush();
        self.credits.flush();
        let after = env::storage_usage();
        let balance = self.storage_balance.get(who).map(|b| b.0).unwrap_or(0);

        if after > before {
            let owed = bytes_to_near(after - before);
            require!(
                balance >= owed,
                "prepay storage first: call storage_deposit, and storage_cost_estimate() is a safe amount"
            );
            self.storage_balance.insert(who.clone(), U128(balance - owed));
        } else if before > after {
            let freed = bytes_to_near(before - after);
            // Only credit an account that already has a ledger entry; creating
            // one here would be state this call did not charge for. Unreachable
            // in practice — every path that can free state required a balance to
            // reach — and if it ever happened the bytes stay as vault headroom,
            // which is the safe direction.
            if self.storage_balance.contains_key(who) {
                self.storage_balance.insert(who.clone(), U128(balance + freed));
            }
        }
    }

    /// Take back prepaid storage that no mandate is using.
    ///
    /// Debited first and restored by the callback if the transfer does not land,
    /// for the same reason `withdraw` has one: a bare `transfer` that fails
    /// would otherwise take the ledger entry down with it. It should never fail
    /// — every prepayment adds the same NEAR to the contract's balance that it
    /// adds to the ledger — but "should never" is not a guard.
    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> Promise {
        require!(env::attached_deposit() >= ONE_YOCTO, "attach 1 yoctoNEAR");
        let who = env::predecessor_account_id();
        let available = self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0);
        let want = amount.map(|a| a.0).unwrap_or(available);
        require!(want > 0 && want <= available, "not that much prepaid storage");
        self.storage_balance.insert(who.clone(), U128(available - want));

        Promise::new(who.clone()).transfer(NearToken::from_yoctonear(want)).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_RESOLVE)
                .resolve_storage_withdraw(who, U128(want)),
        )
    }

    /// Restores a prepaid balance if paying it out failed.
    #[private]
    pub fn resolve_storage_withdraw(
        &mut self,
        who: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        let current = self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0);
        self.storage_balance.insert(who, U128(current + amount.0));
        false
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> U128 {
        self.storage_balance.get(&account_id).copied().unwrap_or(U128(0))
    }

    /// A deposit that comfortably covers one mandate and the fills against it.
    ///
    /// It is a **recommendation, not a price**: what the contract actually takes
    /// is the measured cost of the state each call creates, and anything left
    /// over stays withdrawable via `storage_withdraw`. Deliberately a view, so a
    /// client can size a deposit with no key and no deposit of its own.
    pub fn storage_cost_estimate(&self) -> U128 {
        U128(env::storage_byte_cost().as_yoctonear() * RECOMMENDED_PREPAY_BYTES as u128)
    }

    // ------------------------------------------------------------- the one path

    /// Every state change that moves value starts here.
    ///
    /// NEP-141 calls this when someone `ft_transfer_call`s tokens to the vault.
    /// `env::predecessor_account_id()` is the token contract, so the vault knows
    /// *which asset* arrived; `sender_id` is who sent it and `amount` is how
    /// much. For a fill that is everything needed to verify, synchronously, with
    /// no cross-contract call and therefore no rollback path.
    ///
    /// Returns the unused amount, always `0`: the vault either accepts the whole
    /// transfer or panics, which refunds it.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let asset = asset_id(&env::predecessor_account_id());
        let action: Action = serde_json::from_str(&msg).expect("msg is not a Hallmark action");
        require!(amount.0 > 0, "empty transfer");
        let before = env::storage_usage();

        match action {
            Action::Open { terms } => self.open(sender_id.clone(), asset, amount.0, terms),
            Action::Fund { mandate_id } => {
                self.fund(sender_id.clone(), mandate_id, asset, amount.0)
            }
            Action::Fill { mandate_id, canonical, signature } => {
                self.fill(sender_id.clone(), asset, amount.0, mandate_id, &canonical, &signature)
            }
        }
        // A fill creates credit slots exactly as an open creates a record, so
        // the filler pays for its own state too. Topping up creates nothing and
        // therefore costs nothing.
        self.settle_storage(&sender_id, before);
        U128(0)
    }

    fn open(&mut self, owner: AccountId, asset: String, amount: u128, terms: Mandate) {
        require!(asset == terms.origin_asset, "this token is not the mandate's origin asset");
        // Without this, one token would match both the funding path and the
        // delivery path, and `Action::Fill` could be satisfied with the very
        // asset the owner is trying to sell.
        require!(
            terms.origin_asset != terms.destination_asset,
            "origin and destination must differ"
        );
        // Credits are withdrawn via `token_account()`, which only understands
        // nep141 ids. Rejecting anything else here keeps `withdraw` total.
        require!(
            terms.destination_asset.starts_with("nep141:"),
            "destination must be a nep141 asset"
        );
        require!(terms.max_cost_bps <= 10_000, "a ceiling above 100% bounds nothing");
        require!(terms.max_fill.0 > 0, "max_fill must be positive");
        // A ceiling is enforced against the USD marks the venue signed, so a
        // mandate that accepts arbitrarily old quotes has no ceiling in any
        // useful sense. The filler picks the quote's `deadline`, so only this
        // bounds staleness (§2.10).
        require!(terms.max_quote_age_secs > 0, "max_quote_age_secs must be positive");
        require!(
            terms.max_quote_age_secs <= MAX_QUOTE_AGE_CEILING_SECS,
            "max_quote_age_secs above thirty days bounds nothing useful"
        );
        require!(terms.expiry_ns.0 > env::block_timestamp(), "mandate already expired");
        require!(
            terms.recipient == env::current_account_id().to_string(),
            "the quote's recipient must be this vault, or the delivery cannot be verified"
        );

        let id = self.next_id;
        self.next_id += 1;
        self.mandates.insert(
            id,
            MandateRecord {
                owner: owner.clone(),
                terms,
                escrow: U128(amount),
                delivered: U128(0),
                fills: 0,
                worst_bps: 0,
                open: true,
            },
        );
        self.open_ids.insert(id);
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"hallmark","version":"1.0.0","event":"mandate_opened","data":[{{"mandate_id":"{id}","owner":"{owner}","escrow":"{amount}"}}]}}"#
        ));
    }

    fn fund(&mut self, sender: AccountId, mandate_id: u64, asset: String, amount: u128) {
        let rec = self.mandates.get_mut(&mandate_id).expect("no such mandate");
        require!(rec.open, "mandate is closed");
        // Funding someone else's mandate is a gift with no mechanism behind it,
        // and an expired mandate can never be filled — so topping either one up
        // is a mistake, not a feature.
        require!(sender == rec.owner, "only the owner can fund a mandate");
        require!(rec.terms.expiry_ns.0 > env::block_timestamp(), "mandate has expired");
        require!(asset == rec.terms.origin_asset, "this token is not the mandate's origin asset");
        rec.escrow = U128(rec.escrow.0 + amount);
    }

    /// The delivery. `amount` of the destination asset is already in the vault
    /// by the time this runs; nothing leaves unless every check below passes.
    fn fill(
        &mut self,
        filler: AccountId,
        asset: String,
        delivered: u128,
        mandate_id: u64,
        canonical: &str,
        signature: &str,
    ) {
        let rec = self.mandates.get(&mandate_id).expect("no such mandate").clone();
        require!(rec.open, "mandate is closed");
        require!(
            asset == rec.terms.destination_asset,
            "this token is not the mandate's destination asset"
        );

        let sig = decode_signature(signature).expect("signature is not 64 base58-decoded bytes");

        let accepted =
            match check(canonical.as_bytes(), &sig, &rec.terms, delivered, env::block_timestamp()) {
                Ok(a) => a,
                Err(r) => env::panic_str(&format!("REFUSED {r:?}")),
            };

        require!(
            accepted.amount_in <= rec.escrow.0,
            "the mandate does not hold enough origin asset for this fill"
        );

        // Both legs are credited together. Pull-not-push, so neither side can
        // fail here (ARCHITECTURE.md §4.1).
        self.credit(&rec.owner, &rec.terms.destination_asset, delivered);
        self.credit(&filler, &rec.terms.origin_asset, accepted.amount_in);

        let rec = self.mandates.get_mut(&mandate_id).unwrap();
        rec.escrow = U128(rec.escrow.0 - accepted.amount_in);
        rec.delivered = U128(rec.delivered.0 + delivered);
        rec.fills += 1;
        rec.worst_bps = rec.worst_bps.max(accepted.cost_bps);

        // The receipt. Bound to the filler's account, so an execution record is
        // provable rather than self-reported (ARCHITECTURE.md §6.3).
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"hallmark","version":"1.0.0","event":"filled","data":[{{"mandate_id":"{mandate_id}","filler":"{filler}","amount_in":"{}","delivered":"{delivered}","cost_bps":{},"ceiling_bps":{}}}]}}"#,
            accepted.amount_in, accepted.cost_bps, rec.terms.max_cost_bps
        ));
    }

    // ------------------------------------------------------------------- payout

    /// Pull whatever this account has earned in `asset`.
    #[payable]
    pub fn withdraw(&mut self, asset: String) -> Promise {
        require!(env::attached_deposit() >= ONE_YOCTO, "attach 1 yoctoNEAR");
        let who = env::predecessor_account_id();
        let key = (who.clone(), asset.clone());
        let amount = self.credits.get(&key).map(|b| b.0).unwrap_or(0);
        require!(amount > 0, "nothing to withdraw");
        // Removed, not zeroed: a zeroed slot still occupies storage somebody
        // paid for. The bytes are only *really* gone once the payout lands, so
        // the refund rides along with the callback rather than being credited
        // here — otherwise a failed payout would restore the slot after its
        // storage had already been handed back.
        let before = env::storage_usage();
        self.credits.remove(&key);
        self.credits.flush();
        let freed = bytes_to_near(before.saturating_sub(env::storage_usage()));

        ext_ft::ext(token_account(&asset))
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(who.clone(), U128(amount), Some("hallmark withdrawal".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .resolve_withdraw(who, asset, U128(amount), U128(freed)),
            )
    }

    /// If the transfer failed the credit is restored, so a withdrawal can never
    /// lose a balance. If it succeeded, the storage that slot was using goes
    /// back to the account that was holding it.
    #[private]
    pub fn resolve_withdraw(
        &mut self,
        who: AccountId,
        asset: String,
        amount: U128,
        freed: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            if freed.0 > 0 && self.storage_balance.contains_key(&who) {
                let balance = self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0);
                self.storage_balance.insert(who, U128(balance + freed.0));
            }
            return true;
        }
        // The slot comes back, so its storage was never actually released and
        // must not be refunded.
        let key = (who, asset);
        let current = self.credits.get(&key).map(|b| b.0).unwrap_or(0);
        self.credits.insert(key, U128(current + amount.0));
        false
    }

    /// Close a mandate and credit the unspent escrow back to its owner. Owner
    /// only. Fills already settled are untouched.
    ///
    /// The record **stays** — a settled mandate is its own receipt — so the
    /// storage it occupies is still occupied. `reap` is what releases it, and
    /// only once the bytes are actually gone.
    pub fn cancel(&mut self, mandate_id: u64) {
        let rec = self.mandates.get(&mandate_id).expect("no such mandate").clone();
        require!(env::predecessor_account_id() == rec.owner, "not your mandate");
        require!(rec.open, "mandate is already closed");
        let before = env::storage_usage();

        if rec.escrow.0 > 0 {
            self.credit(&rec.owner, &rec.terms.origin_asset, rec.escrow.0);
        }
        let rec = self.mandates.get_mut(&mandate_id).unwrap();
        rec.escrow = U128(0);
        rec.open = false;
        self.open_ids.remove(&mandate_id);
        // Returning the escrow can create a credit slot, so the owner settles
        // for it like anyone else.
        self.settle_storage(&env::predecessor_account_id(), before);
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"hallmark","version":"1.0.0","event":"mandate_closed","data":[{{"mandate_id":"{mandate_id}"}}]}}"#
        ));
    }

    /// Delete a closed mandate's record and return the storage it frees. Owner
    /// only, and only once the mandate is closed.
    ///
    /// The record is kept until the owner asks for it to go, because a settled
    /// mandate is a receipt a judge or a counterparty may want to read. What
    /// comes back is the measured delta, by the same rule as everything else.
    pub fn reap(&mut self, mandate_id: u64) -> U128 {
        let rec = self.mandates.get(&mandate_id).expect("no such mandate").clone();
        let who = env::predecessor_account_id();
        require!(who == rec.owner, "not your mandate");
        require!(!rec.open, "cancel the mandate first");

        let before = env::storage_usage();
        self.mandates.remove(&mandate_id);
        let was = self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0);
        self.settle_storage(&who, before);
        U128(self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0).saturating_sub(was))
    }

    fn credit(&mut self, who: &AccountId, asset: &str, amount: u128) {
        let key = (who.clone(), asset.to_string());
        let current = self.credits.get(&key).map(|b| b.0).unwrap_or(0);
        self.credits.insert(key, U128(current + amount));
    }

    // -------------------------------------------------------------------- views
    //
    // The proof surface. Every guarantee in ARCHITECTURE.md can be exercised
    // here with no key, no funds and no deposit.

    /// The order book: open mandates only, in id order.
    ///
    /// Reads the open-id index rather than scanning every mandate ever created,
    /// so what this costs tracks what the vault is *holding* rather than what it
    /// remembers (§2.12).
    pub fn get_mandates(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<(u64, MandateRecord)> {
        let mut ids: Vec<u64> = self.open_ids.iter().copied().collect();
        ids.sort_unstable();
        ids.into_iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .filter_map(|id| self.mandates.get(&id).map(|r| (id, r.clone())))
            .collect()
    }

    pub fn get_mandate(&self, mandate_id: u64) -> Option<MandateRecord> {
        self.mandates.get(&mandate_id).cloned()
    }

    /// How many mandates have ever been opened, including closed and reaped
    /// ones. Ids are never reused.
    pub fn mandate_count(&self) -> u64 {
        self.next_id - 1
    }

    /// How many are open right now — the length of the order book, and the
    /// bound on what `get_mandates` costs.
    pub fn open_mandate_count(&self) -> u32 {
        self.open_ids.len()
    }

    pub fn get_credit(&self, account_id: AccountId, asset: String) -> U128 {
        self.credits.get(&(account_id, asset)).copied().unwrap_or(U128(0))
    }

    /// The guaranteed-worst all-in cost of this quote, in bps — the cost if a
    /// filler delivered only the floor the venue signed.
    ///
    /// Pure arithmetic over the bytes it is handed: it does **not** check the
    /// signature, so pair it with `is_signed` before believing it of a quote you
    /// did not fetch yourself. `dry_check` does both.
    pub fn worst_cost(&self, canonical: String) -> u32 {
        worst_cost_bps(&parse_quote(&canonical))
    }

    /// What the owner would actually pay if a filler delivered `delivered`.
    /// Arithmetic only; see `worst_cost`.
    pub fn realised_cost(&self, canonical: String, delivered: U128) -> u32 {
        cost_bps(&parse_quote(&canonical), delivered.0)
    }

    /// Did NEAR Intents really sign exactly these bytes?
    pub fn is_signed(&self, canonical: String, signature: String) -> bool {
        match decode_signature(&signature) {
            Some(sig) => is_signed_by_venue(canonical.as_bytes(), &sig),
            None => false,
        }
    }

    /// How old the venue's own signature on this quote is, in seconds, as the
    /// chain sees it. This is the number `max_quote_age_secs` bounds (§2.10).
    pub fn quote_age_secs(&self, canonical: String) -> U64 {
        let signed_at = quote::parse_iso8601_secs(&parse_quote(&canonical).timestamp);
        U64((env::block_timestamp() / 1_000_000_000).saturating_sub(signed_at))
    }

    /// The full check, exactly as a fill runs it, against terms you supply.
    pub fn dry_check(
        &self,
        canonical: String,
        signature: String,
        terms: Mandate,
        delivered: U128,
    ) -> String {
        let Some(sig) = decode_signature(&signature) else {
            return "REFUSED BadSignature".into();
        };
        match check(canonical.as_bytes(), &sig, &terms, delivered.0, env::block_timestamp()) {
            Ok(a) => format!(
                "ALLOWED at {} bps realised all-in cost, filler earns {} origin units",
                a.cost_bps, a.amount_in
            ),
            Err(r) => format!("REFUSED {r:?}"),
        }
    }

    pub fn quote_signer(&self) -> String {
        QUOTE_SIGNER.to_string()
    }
}

/// A mandate record measures ~300 bytes and a credit slot ~145, so this covers
/// a mandate, its index entry, and several fills with room to spare. Nothing in
/// the contract charges this figure — see `storage_cost_estimate`.
const RECOMMENDED_PREPAY_BYTES: u64 = 1_024;

/// NEAR stakes a fixed amount of an account's balance per byte of state it
/// holds. This is the only conversion in the contract, and every storage charge
/// and refund goes through it.
fn bytes_to_near(bytes: u64) -> u128 {
    bytes as u128 * env::storage_byte_cost().as_yoctonear()
}

/// A sanity bound, not a policy. The contract's job is to enforce the age the
/// owner committed to, not to pick it — a tight bound is the client's default
/// (300 s) and is visible in `get_mandates` for anyone to read. What this stops
/// is a mandate that bounds nothing at all, which is what v1 shipped by
/// omission. Thirty days is also what keeps the captured integration fixture
/// usable; see the note in `contract/tests/integration.rs`.
const MAX_QUOTE_AGE_CEILING_SECS: u32 = 30 * 86_400;

/// Exactly 64 base58 bytes, or nothing. `bs58`'s `onto` leaves the tail of the
/// buffer untouched for a short input, which would silently zero-pad a
/// signature; a verifier should never guess at the length of a signature.
fn decode_signature(signature: &str) -> Option<[u8; 64]> {
    let mut sig = [0u8; 64];
    match bs58::decode(signature.trim_start_matches("ed25519:")).onto(&mut sig) {
        Ok(64) => Some(sig),
        _ => None,
    }
}

fn parse_quote(canonical: &str) -> SignedQuote {
    serde_json::from_slice(canonical.as_bytes()).expect("unparseable quote")
}

/// `wrap.near` -> `nep141:wrap.near`, the form 1Click signs.
fn asset_id(token: &AccountId) -> String {
    format!("nep141:{token}")
}

fn token_account(asset: &str) -> AccountId {
    asset
        .strip_prefix("nep141:")
        .expect("only nep141 assets are supported")
        .parse()
        .expect("bad token account")
}

#[cfg(test)]
mod tests;
