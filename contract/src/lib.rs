//! Hallmark — a not-held order that enforces its own execution bound.
//!
//! An owner funds a mandate naming a pair, a worst acceptable all-in cost, a
//! maximum fill and an expiry. Anyone may fill it. The filler delivers the
//! output **first**, and the vault verifies that delivery against NEAR Intents'
//! own signature before crediting the filler with the input.
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

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, serde_json, AccountId, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
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
    /// (who, asset id) -> withdrawable balance. Payouts are pull, not push, so
    /// a counterparty who is not storage-registered on a token cannot brick a
    /// fill for anyone else.
    credits: LookupMap<(AccountId, String), U128>,
    next_id: u64,
}

#[near]
impl Hallmark {
    #[init]
    pub fn new() -> Self {
        Self {
            mandates: IterableMap::new(b"m"),
            credits: LookupMap::new(b"c"),
            next_id: 1,
        }
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
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> U128 {
        let asset = asset_id(&env::predecessor_account_id());
        let action: Action = serde_json::from_str(&msg).expect("msg is not a Hallmark action");
        require!(amount.0 > 0, "empty transfer");

        match action {
            Action::Open { terms } => self.open(sender_id, asset, amount.0, terms),
            Action::Fund { mandate_id } => self.fund(mandate_id, asset, amount.0),
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
        require!(terms.expiry_ns > env::block_timestamp(), "mandate already expired");
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
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"hallmark","version":"1.0.0","event":"mandate_opened","data":[{{"mandate_id":"{id}","owner":"{owner}","escrow":"{amount}"}}]}}"#
        ));
    }

    fn fund(&mut self, mandate_id: u64, asset: String, amount: u128) {
        let rec = self.mandates.get_mut(&mandate_id).expect("no such mandate");
        require!(rec.open, "mandate is closed");
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

        let mut sig = [0u8; 64];
        bs58::decode(signature.trim_start_matches("ed25519:"))
            .onto(&mut sig)
            .expect("signature is not 64 base58-decoded bytes");

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
        self.credits.insert(key, U128(0));

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
    pub fn get_mandates(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<(u64, MandateRecord)> {
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

    pub fn get_credit(&self, account_id: AccountId, asset: String) -> U128 {
        self.credits.get(&(account_id, asset)).copied().unwrap_or(U128(0))
    }

    /// The guaranteed-worst all-in cost of this quote, in bps — the cost if a
    /// filler delivered only the floor the venue signed.
    pub fn worst_cost(&self, canonical: String) -> u32 {
        worst_cost_bps(&parse_quote(&canonical))
    }

    /// What the owner would actually pay if a filler delivered `delivered`.
    pub fn realised_cost(&self, canonical: String, delivered: U128) -> u32 {
        cost_bps(&parse_quote(&canonical), delivered.0)
    }

    /// Did NEAR Intents really sign exactly these bytes?
    pub fn is_signed(&self, canonical: String, signature: String) -> bool {
        let mut sig = [0u8; 64];
        if bs58::decode(signature.trim_start_matches("ed25519:")).onto(&mut sig).is_err() {
            return false;
        }
        is_signed_by_venue(canonical.as_bytes(), &sig)
    }

    /// The full check, exactly as a fill runs it, against terms you supply.
    pub fn dry_check(
        &self,
        canonical: String,
        signature: String,
        terms: Mandate,
        delivered: U128,
    ) -> String {
        let mut sig = [0u8; 64];
        if bs58::decode(signature.trim_start_matches("ed25519:")).onto(&mut sig).is_err() {
            return "REFUSED BadSignature".into();
        }
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
