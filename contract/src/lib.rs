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
use near_sdk::store::{IterableMap, LookupMap};
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

/// A `(who, asset)` credit slot, generously. The key is an account id (≤64) plus
/// an asset id (≤71 for a 64-hex omni-bridge token), the value is 16 bytes, and
/// the rest is map overhead.
const CREDIT_SLOT_BYTES: u64 = 256;
/// How many credit slots a mandate prepays for. `withdraw` *removes* a slot
/// rather than zeroing it, so an honest mandate needs two at a time and this is
/// slack rather than a limit.
const CREDIT_SLOTS_PREPAID: u64 = 4;

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
    /// what opening this mandate cost its owner in storage staking, in
    /// yoctoNEAR. Returned to their storage balance by `cancel`.
    pub storage_paid: U128,
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
            // v2 prefixes. v1 shipped a `Mandate` without `max_quote_age_secs`,
            // and borsh cannot read a v1 record into a v2 struct, so the new
            // maps get their own namespace rather than tripping over the old
            // bytes. §2.10.
            mandates: IterableMap::new(b"M"),
            credits: LookupMap::new(b"C"),
            storage_balance: LookupMap::new(b"S"),
            next_id: 1,
        }
    }

    /// Replace v1's state wholesale. There is no admin key and no upgrade path
    /// once the full-access key is gone (§10.2); this exists only so the v1
    /// deployment can be superseded in place before that key is deleted, and it
    /// is `#[private]` so only the account itself can call it.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        Self::new()
    }

    // --------------------------------------------------------------- storage

    /// Prepay for the state you are about to create. One deposit covers many
    /// mandates; whatever is left can be withdrawn.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> U128 {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a deposit");
        let now = self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0) + amount;
        self.storage_balance.insert(who, U128(now));
        U128(now)
    }

    /// Take back prepaid storage that no mandate is using.
    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> Promise {
        require!(env::attached_deposit() >= ONE_YOCTO, "attach 1 yoctoNEAR");
        let who = env::predecessor_account_id();
        let available = self.storage_balance.get(&who).map(|b| b.0).unwrap_or(0);
        let want = amount.map(|a| a.0).unwrap_or(available);
        require!(want > 0 && want <= available, "not that much prepaid storage");
        self.storage_balance.insert(who.clone(), U128(available - want));
        Promise::new(who).transfer(NearToken::from_yoctonear(want))
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> U128 {
        self.storage_balance.get(&account_id).copied().unwrap_or(U128(0))
    }

    /// What `open` will charge, so a client can prepay exactly once and know it
    /// is enough. Deliberately a view: it needs no key and no deposit.
    pub fn storage_cost_estimate(&self) -> U128 {
        U128(
            env::storage_byte_cost().as_yoctonear()
                * (MANDATE_RECORD_BYTES + CREDIT_SLOT_BYTES * CREDIT_SLOTS_PREPAID) as u128,
        )
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

        match action {
            Action::Open { terms } => self.open(sender_id, asset, amount.0, terms),
            Action::Fund { mandate_id } => self.fund(sender_id, mandate_id, asset, amount.0),
            Action::Fill { mandate_id, canonical, signature } => {
                self.fill(sender_id, asset, amount.0, mandate_id, &canonical, &signature)
            }
        }
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

        // The opener pays for the state the opener creates. Charged against a
        // prepaid balance because `ft_on_transfer` carries no deposit.
        let charge = self.storage_cost_estimate().0;
        let prepaid = self.storage_balance.get(&owner).map(|b| b.0).unwrap_or(0);
        require!(
            prepaid >= charge,
            "prepay storage first: call storage_deposit with at least storage_cost_estimate()"
        );
        self.storage_balance.insert(owner.clone(), U128(prepaid - charge));

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
                storage_paid: U128(charge),
            },
        );
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
        // Removed, not zeroed. A zeroed slot still occupies storage the vault
        // paid for, so a filler could mint slots faster than the mandate that
        // prepaid for them. Removing makes an honest round trip
        // storage-neutral.
        self.credits.remove(&key);

        ext_ft::ext(token_account(&asset))
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(who.clone(), U128(amount), Some("hallmark withdrawal".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .resolve_withdraw(who, asset, U128(amount)),
            )
    }

    /// If the transfer failed the credit is restored, so a withdrawal can never
    /// lose a balance.
    #[private]
    pub fn resolve_withdraw(
        &mut self,
        who: AccountId,
        asset: String,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            return true;
        }
        let key = (who, asset);
        let current = self.credits.get(&key).map(|b| b.0).unwrap_or(0);
        self.credits.insert(key, U128(current + amount.0));
        false
    }

    /// Close a mandate and credit the unspent escrow back to its owner. Owner
    /// only. Fills already settled are untouched.
    ///
    /// The record **stays** — a settled mandate is its own receipt — and so does
    /// the storage prepayment, because the state is still there. `reap` is what
    /// returns it, and only once the bytes are actually gone.
    pub fn cancel(&mut self, mandate_id: u64) {
        let rec = self.mandates.get(&mandate_id).expect("no such mandate").clone();
        require!(env::predecessor_account_id() == rec.owner, "not your mandate");
        require!(rec.open, "mandate is already closed");

        if rec.escrow.0 > 0 {
            self.credit(&rec.owner, &rec.terms.origin_asset, rec.escrow.0);
        }
        let rec = self.mandates.get_mut(&mandate_id).unwrap();
        rec.escrow = U128(0);
        rec.open = false;
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"hallmark","version":"1.0.0","event":"mandate_closed","data":[{{"mandate_id":"{mandate_id}"}}]}}"#
        ));
    }

    /// Delete a closed mandate's record and return the storage it actually
    /// frees. Owner only.
    ///
    /// The refund is the **measured** delta, capped at what was paid. An earlier
    /// version had `cancel` return the whole prepayment while leaving the
    /// 296-byte record in place, which made opening and cancelling in a loop a
    /// slower version of exactly the attack §2.11 exists to stop. Measuring
    /// rather than assuming is the only way this is safe: whatever is not
    /// refunded is still covering bytes that are still there.
    pub fn reap(&mut self, mandate_id: u64) -> U128 {
        let rec = self.mandates.get(&mandate_id).expect("no such mandate").clone();
        require!(env::predecessor_account_id() == rec.owner, "not your mandate");
        require!(!rec.open, "cancel the mandate first");
        require!(rec.storage_paid.0 > 0, "already reaped");

        // `store` collections buffer their writes and flush when the call ends,
        // so `storage_usage()` right after a `remove` still reports the old
        // figure and the refund would come out as zero. Flush, then measure.
        let before = env::storage_usage();
        self.mandates.remove(&mandate_id);
        self.mandates.flush();
        let freed = before.saturating_sub(env::storage_usage()) as u128
            * env::storage_byte_cost().as_yoctonear();
        let refund = freed.min(rec.storage_paid.0);

        let prepaid = self.storage_balance.get(&rec.owner).map(|b| b.0).unwrap_or(0);
        self.storage_balance.insert(rec.owner.clone(), U128(prepaid + refund));
        U128(refund)
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

    /// What fillers read.
    pub fn get_mandates(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<(u64, MandateRecord)> {
        let from = from_index.unwrap_or(0);
        self.mandates
            .iter()
            .filter(|(_, r)| r.open)
            .skip(from as usize)
            .take(limit.unwrap_or(50) as usize)
            .map(|(id, r)| (*id, r.clone()))
            .collect()
    }

    pub fn get_mandate(&self, mandate_id: u64) -> Option<MandateRecord> {
        self.mandates.get(&mandate_id).cloned()
    }

    /// How many mandates have ever been opened. `get_mandates` scans from the
    /// start, so a caller that needs to page knows the bound.
    pub fn mandate_count(&self) -> u64 {
        self.next_id - 1
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

/// A mandate record, borsh-encoded, rounded up. Measured by
/// `opening_a_mandate_is_paid_for_by_its_owner`, which fails if it is ever an
/// underestimate.
const MANDATE_RECORD_BYTES: u64 = 512;
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
