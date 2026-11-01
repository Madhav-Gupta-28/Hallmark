//! Every guarantee ARCHITECTURE.md claims is enforced by a test named here.
//!
//! No network, no key, no funds: `cargo test` from a clean clone.

use crate::mandate::{check as raw_check, Mandate, Refusal};
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
///
/// "Now" is a minute after each fixture was *signed*, not a shared wall clock,
/// because a mandate now bounds how stale a quote may be (§2.10) and the two
/// fixtures were signed two days apart.
const HONEST_SIGNED_NS: u64 = 1_793_297_130_000_000_000; // 2026-10-29T18:05:30Z
const WORST_SIGNED_NS: u64 = 1_793_460_074_000_000_000; // 2026-10-31T15:21:14Z
const MINUTE_NS: u64 = 60_000_000_000;
const NOW_NS: u64 = HONEST_SIGNED_NS + MINUTE_NS;
const WORST_NOW_NS: u64 = WORST_SIGNED_NS + MINUTE_NS;

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
        max_fill: near_sdk::json_types::U128(10_000_000),
        max_quote_age_secs: 300,
        expiry_ns: near_sdk::json_types::U64(u64::MAX),
    }
}

/// The tests assert on the realised cost, so unwrap `Accepted` here.
fn check(
    canonical: &[u8],
    signature: &[u8; 64],
    m: &Mandate,
    delivered: u128,
    now_ns: u64,
) -> Result<u32, Refusal> {
    raw_check(canonical, signature, m, delivered, now_ns).map(|a| a.cost_bps)
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
        check(WORST, &sig(WORST_SIG), &m, WORST_FLOOR, WORST_NOW_NS),
        Err(Refusal::CostCeilingBreached { worst_bps: 10_000, ceiling_bps: 30 })
    );
    // Honoured in FULL it still costs 503 bps: $9.4965 out against $9.9992 in,
    // which is the 500 bps of appFees requested on this quote.
    assert_eq!(
        check(WORST, &sig(WORST_SIG), &m, WORST_EXPECTED, WORST_NOW_NS),
        Err(Refusal::CostCeilingBreached { worst_bps: 503, ceiling_bps: 30 })
    );
    // A ceiling that tolerates the fee accepts it. That is the owner's call.
    assert_eq!(check(WORST, &sig(WORST_SIG), &mandate(600), WORST_EXPECTED, WORST_NOW_NS), Ok(503));
}

// ---------------------------------------------------------------- the mandate

#[test]
fn mandate_refuses_the_malicious_quote_and_says_why() {
    assert_eq!(
        check(WORST, &sig(WORST_SIG), &mandate(30), WORST_FLOOR, WORST_NOW_NS),
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
    // The quote is 23 days old by then, so widen the age bound to isolate the
    // deadline check — `QuoteExpired` must be reachable on its own.
    let m = Mandate { max_quote_age_secs: u32::MAX, ..mandate(10_000) };
    match check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, after) {
        Err(Refusal::QuoteExpired { deadline_secs, .. }) => {
            assert_eq!(deadline_secs, 1_795_132_800); // 2026-11-20T00:00:00Z
        }
        other => panic!("expected QuoteExpired, got {other:?}"),
    }
}

#[test]
fn an_expired_mandate_is_refused() {
    let m = Mandate { expiry_ns: near_sdk::json_types::U64(NOW_NS - 1), ..mandate(10_000) };
    assert_eq!(
        check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS),
        Err(Refusal::MandateExpired)
    );
}

#[test]
fn a_fill_larger_than_the_mandate_allows_is_refused() {
    let m = Mandate { max_fill: near_sdk::json_types::U128(9_999_999), ..mandate(10_000) };
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

// ------------------------------------------------------- staleness (§2.10)
//
// The attack these pin down: `deadline` is chosen by whoever requests the
// quote, and 1Click signs a deadline ten years out on a free `dry: true`
// quote. So a filler can mint a library of signed quotes for nothing, hold
// them, and exercise whichever one the market has since made profitable. The
// ceiling would still pass, because the ceiling is computed from USD marks
// frozen at signing time. `max_quote_age_secs` is what makes the ceiling a
// statement about the market rather than about a memory.

/// The headline: validly signed, inside its own deadline, and refused anyway.
#[test]
fn a_stale_quote_is_refused_even_though_it_is_signed_and_inside_its_deadline() {
    let m = mandate(10_000); // a ceiling that refuses nothing
    let an_hour_later = HONEST_SIGNED_NS + 3_600 * 1_000_000_000;

    // Same bytes, same signature, same deadline — only the clock moved.
    assert!(is_signed_by_venue(HONEST, &sig(HONEST_SIG)));
    assert_eq!(check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS), Ok(160));
    assert_eq!(
        raw_check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, an_hour_later),
        Err(Refusal::QuoteTooOld {
            signed_at_secs: 1_793_297_130,
            now_secs: 1_793_297_130 + 3_600,
            max_age_secs: 300,
        })
    );
}

/// The boundary is exact, and inclusive of the last allowed second.
#[test]
fn the_freshness_bound_is_exact_to_the_second() {
    let m = Mandate { max_quote_age_secs: 60, ..mandate(10_000) };
    let at = |secs: u64| HONEST_SIGNED_NS + secs * 1_000_000_000;
    assert!(check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, at(0)).is_ok());
    assert!(check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, at(60)).is_ok());
    assert!(matches!(
        raw_check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, at(61)),
        Err(Refusal::QuoteTooOld { .. })
    ));
}

/// `timestamp` is inside the signature, so the staleness bound cannot be
/// forged — the same property that makes the cost bound work.
#[test]
fn the_signing_time_is_covered_by_the_signature() {
    let ts = b"\"timestamp\":\"2026-10-29T18:05:30.496Z\"";
    let at = HONEST
        .windows(ts.len())
        .position(|w| w == ts)
        .expect("the canonical bytes must carry the signed timestamp");
    let mut tampered = HONEST.to_vec();
    tampered[at + 20] = b'9'; // move the signing year forward
    assert!(!is_signed_by_venue(&tampered, &sig(HONEST_SIG)));
}

/// A mandate that accepts quotes of any age has no ceiling worth the name, so
/// `open` refuses to create one. Pinned here and on-chain in the integration
/// suite.
#[test]
fn the_age_bound_has_to_be_set_and_has_to_be_sane() {
    assert_eq!(parse(HONEST).timestamp, "2026-10-29T18:05:30.496Z");
    // 0 would refuse everything; a year would bound nothing. Both are rejected
    // by `open` — see `open_refuses_terms_that_could_not_be_enforced`.
    let m = Mandate { max_quote_age_secs: 0, ..mandate(10_000) };
    assert!(matches!(
        raw_check(HONEST, &sig(HONEST_SIG), &m, HONEST_FLOOR, NOW_NS),
        Err(Refusal::QuoteTooOld { .. })
    ));
}

// ------------------------------------------------------- parsing boundaries

/// A date that does not exist must not silently become one that does.
/// `2026-02-31` used to parse as 3 March — a deadline three days later than
/// the string it was read from.
#[test]
fn a_date_that_does_not_exist_is_refused() {
    assert_eq!(days_in_month(2026, 2), 28);
    assert_eq!(days_in_month(2024, 2), 29); // leap
    assert_eq!(days_in_month(2000, 2), 29); // 400-year rule
    assert_eq!(days_in_month(1900, 2), 28); // 100-year rule
    assert_eq!(days_in_month(2026, 4), 30);
}

#[test]
#[should_panic(expected = "deadline day range")]
fn the_31st_of_february_is_not_guessed_at() {
    parse_iso8601_secs("2026-02-31T00:00:00Z");
}

#[test]
#[should_panic(expected = "deadline day range")]
fn the_31st_of_april_is_not_guessed_at() {
    parse_iso8601_secs("2026-04-31T00:00:00Z");
}

#[test]
#[should_panic(expected = "deadline month range")]
fn a_thirteenth_month_is_refused() {
    parse_iso8601_secs("2026-13-01T00:00:00Z");
}

/// A signature is 64 bytes or it is not a signature. `bs58`'s `onto` leaves
/// the tail of the buffer untouched on a short input, which would zero-pad
/// one; the decoder must reject rather than pad.
#[test]
fn a_signature_is_sixty_four_bytes_or_nothing() {
    let good = bs58::encode(HONEST_SIG).into_string();
    assert!(crate::decode_signature(&good).is_some());
    assert!(crate::decode_signature(&format!("ed25519:{good}")).is_some());
    assert!(crate::decode_signature(&bs58::encode(&HONEST_SIG[..63]).into_string()).is_none());
    assert!(crate::decode_signature(&bs58::encode([7u8; 65]).into_string()).is_none());
    assert!(crate::decode_signature("").is_none());
    assert!(crate::decode_signature("not base58 at all 0OIl").is_none());
}
