//! Every guarantee ARCHITECTURE.md claims is enforced by a test named here.
//!
//! No network, no key, no funds: `cargo test` from a clean clone.

use crate::mandate::{check, Mandate, Refusal};
use crate::quote::*;
use near_sdk::env;

const PUB: &[u8] = include_bytes!("../fixtures/pub.bin");
const HONEST: &[u8] = include_bytes!("../fixtures/honest.canonical.json");
const HONEST_SIG: &[u8] = include_bytes!("../fixtures/honest.sig.bin");
const WORST: &[u8] = include_bytes!("../fixtures/worst.canonical.json");
const WORST_SIG: &[u8] = include_bytes!("../fixtures/worst.sig.bin");

/// What each fixture guarantees, and what it expects — the four numbers the
/// invariant runs on, copied straight out of the signed bytes.
const HONEST_FLOOR: u128 = 2195590043365775454985587;
const HONEST_EXPECTED: u128 = 2217767720571490358571300;
const WORST_FLOOR: u128 = 214367530430548360111;
const WORST_EXPECTED: u128 = 2143675304305483601119090;

/// Both fixtures carry deadline 2026-11-20T00:00:00.000Z, so the tests pin a
/// fixed "now" rather than depending on the wall clock.
const NOW_NS: u64 = 1_793_491_200_000_000_000; // 2026-11-01T00:00:00Z

fn sig(b: &[u8]) -> [u8; 64] {
    b.try_into().unwrap()
}

fn mandate(max_cost_bps: u32) -> Mandate {
    Mandate {
        origin_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
            .into(),
        destination_asset: "nep141:wrap.near".into(),
        recipient: "demo.near".into(),
        max_cost_bps,
        max_fill: 10_000_000,
        expiry_ns: u64::MAX,
    }
}

fn parse(b: &[u8]) -> SignedQuote {
    near_sdk::serde_json::from_slice(b).unwrap()
}

// ---------------------------------------------------------------- the signature

#[test]
fn signer_key_matches_the_published_one() {
    assert_eq!(&signer_pk()[..], PUB);
}

/// Hash-then-parse, against a real signature produced by 1Click's own signer,
/// inside the NEAR VM.
#[test]
fn verifies_a_live_signature_inside_the_vm() {
    assert_eq!(
        bs58::encode(env::sha256_array(HONEST)).into_string(),
        "8no2rMSjesYe97Jhi6RWKxRvvYsYARBVQZXtMDMyhvwp"
    );
    assert!(is_signed_by_venue(HONEST, &sig(HONEST_SIG)));
}

#[test]
fn verifies_the_malicious_signature_too() {
    assert_eq!(
        bs58::encode(env::sha256_array(WORST)).into_string(),
        "FTTFigJiyLLbx9Um6FC17P8UvRwfuSA1DRMDeNZvTj33"
    );
    assert!(is_signed_by_venue(WORST, &sig(WORST_SIG)));
}

/// One flipped byte anywhere in 692 must break it. This is what makes the bound
/// a bound: no field can be edited after the venue signed it.
#[test]
fn every_single_byte_is_covered_by_the_signature() {
    for i in 0..HONEST.len() {
        let mut tampered = HONEST.to_vec();
        tampered[i] ^= 0x01;
        assert!(
            !is_signed_by_venue(&tampered, &sig(HONEST_SIG)),
            "byte {i} was not covered by the signature"
        );
    }
}

#[test]
fn a_forged_quote_is_refused_before_any_field_is_read() {
    assert_eq!(
        check(HONEST, &sig(WORST_SIG), &mandate(10_000), HONEST_FLOOR, NOW_NS),
        Err(Refusal::BadSignature)
    );
}

// ---------------------------------------------------------------- the invariant

#[test]
fn honest_quote_costs_what_the_api_implies() {
    // exact: 1 - (9.93559938816 * 2195590043365775454985587
    //              / 2217767720571490358571300) / 9.99552 = 159.347994 bps
    assert_eq!(worst_cost_bps(&parse(HONEST)), 160);
    assert_eq!(parse(HONEST).slippage_tolerance, 100);
}

/// The whole thesis in one assertion: `slippageTolerance` says 9999, but the
/// number that matters is not the one the policy engines read.
#[test]
fn malicious_quote_is_a_9999_bps_haircut_and_is_validly_signed() {
    let q = parse(WORST);
    assert_eq!(q.slippage_tolerance, 9999);
    assert_eq!(worst_cost_bps(&q), 10_000); // exact 9999.05, rounded up
    // and `amountOut` alone looks perfectly healthy: 2.14 wNEAR for $10
    assert_eq!(q.amount_out, WORST_EXPECTED.to_string());
}

/// The bound must never be understated. Pin the direction explicitly.
#[test]
fn the_reported_cost_is_never_below_the_true_cost() {
    let reported = worst_cost_bps(&parse(HONEST)) as f64;
    let exact = (1.0
        - (9.935599388160_f64 * HONEST_FLOOR as f64 / HONEST_EXPECTED as f64) / 9.995520000000_f64)
        * 10_000.0;
    assert!(reported >= exact, "reported {reported} < true {exact}");
    assert!(reported - exact < 1.0, "bound is loose by more than a bp");
}

/// Delivering more costs the owner less. The ceiling is enforced on the realised
/// outcome, and the filler's pay is the spread it keeps — so there is no fee
/// field anywhere in the mandate (ARCHITECTURE.md §2.5).
#[test]
fn delivering_above_the_floor_lowers_the_owners_realised_cost() {
    let m = mandate(200);
    assert_eq!(check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS), Ok(160));
    assert_eq!(check(HONEST, &sig(HONEST_SIG), &m, HONEST_EXPECTED, NOW_NS), Ok(60));
    assert_eq!(
        check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR - 1, NOW_NS),
        Err(Refusal::UnderDelivered { delivered: HONEST_FLOOR - 1, floor: HONEST_FLOOR })
    );
}

/// `appFees` is not covered by the signature, so the contract cannot read it —
/// and prices it exactly anyway, because its effect is inside the signed
/// `amountOutUsd` (ARCHITECTURE.md §2.3).
#[test]
fn the_malicious_quote_is_refused_at_its_floor_but_fine_at_its_expected_fill() {
    let m = mandate(30);
    assert_eq!(
        check(WORST, &sig(WORST_SIG), &m, WORST_FLOOR, NOW_NS),
        Err(Refusal::CostCeilingBreached { worst_bps: 10_000, ceiling_bps: 30 })
    );
    // Honoured in FULL it still costs 503 bps: $9.4965 out against $9.9992 in,
    // which is the 500 bps of appFees requested on this quote.
    assert_eq!(
        check(WORST, &sig(WORST_SIG), &m, WORST_EXPECTED, NOW_NS),
        Err(Refusal::CostCeilingBreached { worst_bps: 503, ceiling_bps: 30 })
    );
    // A ceiling that tolerates the fee accepts it. That is the owner's call.
    assert_eq!(check(WORST, &sig(WORST_SIG), &mandate(600), WORST_EXPECTED, NOW_NS), Ok(503));
}

// ---------------------------------------------------------------- the mandate

#[test]
fn mandate_refuses_the_malicious_quote_and_says_why() {
    assert_eq!(
        check(WORST, &sig(WORST_SIG), &mandate(30), WORST_FLOOR, NOW_NS),
        Err(Refusal::CostCeilingBreached { worst_bps: 10_000, ceiling_bps: 30 })
    );
}

#[test]
fn mandate_accepts_an_in_bound_quote() {
    assert_eq!(check(HONEST, &sig(HONEST_SIG), &mandate(200), HONEST_FLOOR, NOW_NS), Ok(160));
    assert_eq!(
        check(HONEST, &sig(HONEST_SIG), &mandate(100), HONEST_FLOOR, NOW_NS),
        Err(Refusal::CostCeilingBreached { worst_bps: 160, ceiling_bps: 100 })
    );
}

#[test]
fn a_quote_for_the_wrong_pair_is_refused() {
    let m = Mandate { destination_asset: "nep141:usdt.tether-token.near".into(), ..mandate(10_000) };
    assert_eq!(
        check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS),
        Err(Refusal::WrongAsset)
    );
}

#[test]
fn a_quote_routed_to_someone_else_is_refused() {
    let m = Mandate { recipient: "not-the-vault.near".into(), ..mandate(10_000) };
    assert_eq!(
        check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS),
        Err(Refusal::WrongRecipient)
    );
}

#[test]
fn an_expired_quote_is_refused_even_though_it_is_validly_signed() {
    let after = 1_795_219_200u64 * 1_000_000_000; // 2026-11-21, one day past
    match check(HONEST, &sig(HONEST_SIG), &mandate(10_000), HONEST_FLOOR, after) {
        Err(Refusal::QuoteExpired { deadline_secs, .. }) => {
            assert_eq!(deadline_secs, 1_795_132_800); // 2026-11-20T00:00:00Z
        }
        other => panic!("expected QuoteExpired, got {other:?}"),
    }
}

#[test]
fn an_expired_mandate_is_refused() {
    let m = Mandate { expiry_ns: NOW_NS - 1, ..mandate(10_000) };
    assert_eq!(
        check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS),
        Err(Refusal::MandateExpired)
    );
}

#[test]
fn a_fill_larger_than_the_mandate_allows_is_refused() {
    let m = Mandate { max_fill: 9_999_999, ..mandate(10_000) };
    assert_eq!(
        check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS),
        Err(Refusal::FillTooLarge { amount_in: 10_000_000, max_fill: 9_999_999 })
    );
}

// ---------------------------------------------------------------- arithmetic

/// The deadline is a security boundary, so the parser is pinned hard.
#[test]
fn iso8601_parsing_is_exact() {
    assert_eq!(parse_iso8601_secs("1970-01-02T00:00:00.000Z"), 86_400);
    assert_eq!(parse_iso8601_secs("2026-11-20T00:00:00.000Z"), 1_795_132_800);
    assert_eq!(parse_iso8601_secs("2026-11-20T00:00:00Z"), 1_795_132_800);
    // leap year handling, the classic off-by-one-day bug
    assert_eq!(parse_iso8601_secs("2024-02-29T12:00:00Z"), 1_709_208_000);
    assert_eq!(parse_iso8601_secs("2026-01-01T00:00:00Z"), 1_767_225_600);
}

#[test]
#[should_panic(expected = "deadline")]
fn a_malformed_deadline_panics_rather_than_being_guessed_at() {
    parse_iso8601_secs("2026-11-20 00:00:00Z");
}

#[test]
fn mul_div_does_not_overflow_at_realistic_magnitudes() {
    // $1M of a 24-decimal token
    let min_out = 2_200_000u128 * 10u128.pow(24);
    assert_eq!(mul_div(min_out, 1_000_000_000, min_out), 1_000_000_000);
    assert_eq!(mul_div(u128::MAX / 2, 2, u128::MAX / 2), 2);
    assert_eq!(mul_div(7, 1_000_000_000, 3), 2_333_333_333);
}

#[test]
fn parse_fixed_truncates_toward_a_worse_cost() {
    assert_eq!(parse_fixed("9.999220000000", 12), 9_999_220_000_000);
    assert_eq!(parse_fixed("10", 12), 10_000_000_000_000);
    assert_eq!(parse_fixed("0.000000000001", 12), 1);
}
