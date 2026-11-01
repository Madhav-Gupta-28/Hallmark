//! The mandate, the refusals, and the check that stands between them.

use crate::quote::{cost_bps, is_signed_by_venue, parse_iso8601_secs, SignedQuote};
use near_sdk::near;

/// What the owner signs, once. Three numbers and an expiry: no policy language,
/// no allowlist, no per-protocol configuration.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Mandate {
    pub origin_asset: String,
    pub destination_asset: String,
    pub recipient: String,
    /// the whole point: the worst all-in cost the owner will accept, in bps
    pub max_cost_bps: u32,
    /// the largest single fill, in origin base units
    pub max_fill: u128,
    pub expiry_ns: u64,
}

#[derive(Debug, PartialEq)]
pub enum Refusal {
    BadSignature,
    /// `worst_bps` already includes the filler's fee.
    CostCeilingBreached { worst_bps: u32, ceiling_bps: u32 },
    /// The filler sent less than the quote's own signed floor.
    UnderDelivered { delivered: u128, floor: u128 },
    WrongAsset,
    WrongRecipient,
    FillTooLarge { amount_in: u128, max_fill: u128 },
    /// The quote's own signed deadline has passed.
    QuoteExpired { deadline_secs: u64, now_secs: u64 },
    /// The owner's mandate has expired.
    MandateExpired,
}

/// Verify a quote against a mandate. `canonical` is the exact byte string the
/// client hashed; the contract re-hashes it rather than re-serialising, so there
/// is no canonicalisation logic in Rust at all and therefore no way for Rust and
/// TypeScript to disagree about it.
/// Verify a delivery against a mandate.
///
/// `canonical` is the exact byte string the client hashed. `delivered` is what
/// the filler actually just transferred in — known synchronously, because the
/// filler delivers *before* anything leaves the vault. That is what lets this
/// enforce the **realised** cost rather than merely a bound on it.
pub fn check(
    canonical: &[u8],
    signature: &[u8; 64],
    m: &Mandate,
    delivered: u128,
    now_ns: u64,
) -> Result<u32, Refusal> {
    if !is_signed_by_venue(canonical, signature) {
        return Err(Refusal::BadSignature);
    }

    let q: SignedQuote = near_sdk::serde_json::from_slice(canonical).expect("unparseable quote");

    if q.origin_asset != m.origin_asset || q.destination_asset != m.destination_asset {
        return Err(Refusal::WrongAsset);
    }
    if q.recipient != m.recipient {
        return Err(Refusal::WrongRecipient);
    }
    if now_ns >= m.expiry_ns {
        return Err(Refusal::MandateExpired);
    }
    let now_secs = now_ns / 1_000_000_000;
    let deadline_secs = parse_iso8601_secs(&q.deadline);
    if now_secs >= deadline_secs {
        return Err(Refusal::QuoteExpired { deadline_secs, now_secs });
    }
    let amount_in: u128 = q.amount_in.parse().expect("bad amountIn");
    if amount_in > m.max_fill {
        return Err(Refusal::FillTooLarge { amount_in, max_fill: m.max_fill });
    }
    // The quote's own floor is a hard sanity bound on the delivery.
    let floor: u128 = q.min_amount_out.parse().expect("bad minAmountOut");
    if delivered < floor {
        return Err(Refusal::UnderDelivered { delivered, floor });
    }
    // The ceiling is enforced on what the owner ACTUALLY received. The filler's
    // compensation is the spread it keeps, so it is inside this number already
    // and needs no separate fee field.
    let cost = cost_bps(&q, delivered);
    if cost > m.max_cost_bps {
        return Err(Refusal::CostCeilingBreached { worst_bps: cost, ceiling_bps: m.max_cost_bps });
    }
    Ok(cost)
}

