//! The signed quote: what 1Click's signature covers, and the one invariant.
//!
//! Nothing in this module reads an unsigned field. `appFees` and
//! `depositAddress` are absent from `SignedQuote` by construction, so reading
//! one is a compile error rather than a code review (ARCHITECTURE.md §3.2).

use near_sdk::{env, require};
use serde::Deserialize;

/// The 1Click quote signer. Verified to have signed every quote captured on
/// 2026-10-29 and 2026-10-31 (ARCHITECTURE.md §3.1).
pub const QUOTE_SIGNER: &str = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/// The signer's public key, decoded.
pub fn signer_pk() -> [u8; 32] {
    let mut pk = [0u8; 32];
    bs58::decode(QUOTE_SIGNER.trim_start_matches("ed25519:"))
        .onto(&mut pk)
        .expect("bad signer key");
    pk
}

/// Did 1Click sign exactly these bytes?
///
/// Hash first, parse second, the same bytes both times. The contract never
/// serialises JSON, so Rust and TypeScript cannot disagree about canonical form
/// (ARCHITECTURE.md §2.6). The signature is over the UTF-8 of the base58 string
/// of the digest, not over the digest itself (§3.3).
pub fn is_signed_by_venue(canonical: &[u8], signature: &[u8; 64]) -> bool {
    let message = bs58::encode(env::sha256_array(canonical)).into_string();
    env::ed25519_verify(signature, message.as_bytes(), &signer_pk())
}

/// Only the fields the signature actually covers. `appFees`, `depositMode`,
/// `confidentiality` and `insured` are deliberately absent: they are not signed,
/// so the contract must never read them. Their *effect* is already inside
/// `amountOutUsd`, which is signed.
#[derive(Deserialize)]
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
    pub deadline: String,
    pub slippage_tolerance: u32,
}

/// 256-bit intermediate so `a * b / c` cannot overflow for any token decimals
/// NEAR Intents lists (wNEAR is 24, so a $1M order is ~1e30 base units).
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    require!(c != 0, "divide by zero");
    let (mut hi, mut lo) = {
        let (a_hi, a_lo) = (a >> 64, a & u64::MAX as u128);
        let (b_hi, b_lo) = (b >> 64, b & u64::MAX as u128);
        let ll = a_lo * b_lo;
        let lh = a_lo * b_hi;
        let hl = a_hi * b_lo;
        let hh = a_hi * b_hi;
        let mid = (ll >> 64) + (lh & u64::MAX as u128) + (hl & u64::MAX as u128);
        (hh + (lh >> 64) + (hl >> 64) + (mid >> 64), (mid << 64) | (ll & u64::MAX as u128))
    };
    // restoring long division, 256 / 128
    let mut q = 0u128;
    for _ in 0..128 {
        let carry = hi >> 127;
        hi = (hi << 1) | (lo >> 127);
        lo <<= 1;
        q <<= 1;
        if carry == 1 || hi >= c {
            hi = hi.wrapping_sub(c);
            q |= 1;
        }
    }
    q
}

/// Parses a decimal string ("9.496481598073") to an integer scaled by 1e`scale`.
/// Truncates rather than rounds. Truncating `amountOutUsd` understates what the
/// output is worth and so overstates the cost, which is the safe direction.
pub fn parse_fixed(s: &str, scale: u32) -> u128 {
    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    let mut v: u128 = int_part.parse().expect("bad integer part");
    for i in 0..scale {
        v = v.checked_mul(10).expect("usd overflow");
        v += frac_part.as_bytes().get(i as usize).map_or(0, |c| {
            require!(c.is_ascii_digit(), "bad fraction");
            (c - b'0') as u128
        });
    }
    v
}

/// Days since the Unix epoch for a proleptic-Gregorian date (Howard Hinnant's
/// `days_from_civil`). Integer only, no leap-second nonsense, no chrono.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parses exactly the shape 1Click signs — `2026-11-20T00:00:00.000Z` — to Unix
/// seconds. Deliberately strict: a `deadline` is a security boundary, so an
/// unrecognised shape must panic rather than be guessed at. An optional
/// fractional part is accepted and discarded; anything else is rejected.
pub fn parse_iso8601_secs(s: &str) -> u64 {
    let b = s.as_bytes();
    require!(b.len() >= 20, "deadline too short");
    let num = |r: core::ops::Range<usize>| -> i64 {
        let mut v = 0i64;
        for i in r {
            require!(b[i].is_ascii_digit(), "deadline is not a digit where one is required");
            v = v * 10 + (b[i] - b'0') as i64;
        }
        v
    };
    require!(b[4] == b'-' && b[7] == b'-' && b[10] == b'T', "deadline shape");
    require!(b[13] == b':' && b[16] == b':' && b[b.len() - 1] == b'Z', "deadline shape");
    if b.len() > 20 {
        require!(b[19] == b'.' && b.len() == 24, "deadline fraction shape");
    }
    let (y, mo, d) = (num(0..4), num(5..7), num(8..10));
    let (h, mi, sec) = (num(11..13), num(14..16), num(17..19));
    require!((1..=12).contains(&mo) && (1..=31).contains(&d), "deadline date range");
    require!(h < 24 && mi < 60 && sec < 60, "deadline time range");
    let days = days_from_civil(y, mo, d);
    require!(days > 0, "deadline before the epoch");
    (days * 86_400 + h * 3_600 + mi * 60 + sec) as u64
}

const USD_SCALE: u32 = 12; // 1Click returns 12 dp on both USD marks
const RATIO: u128 = 1_000_000_000; // 1e-9 resolution, 10^5 finer than one bp

/// The one invariant, in basis points.
///
///   worst_cost = 1 - (amountOutUsd * minAmountOut / amountOut) / amountInUsd
///
/// `amountOutUsd` marks what the output is worth at `amountOut`. Scaling it by
/// `minAmountOut / amountOut` marks the *floor* instead. Dividing by
/// `amountInUsd` gives the all-in cost of the worst fill the venue has signed
/// itself up to: slippage, bridge fee, solver spread and any app fee, together,
/// because every one of them has already moved these four numbers.
pub fn cost_bps(q: &SignedQuote, delivered: u128) -> u32 {
    let in_usd = parse_fixed(&q.amount_in_usd, USD_SCALE);
    let out_usd = parse_fixed(&q.amount_out_usd, USD_SCALE);
    let amount_out: u128 = q.amount_out.parse().expect("bad amountOut");
    require!(in_usd > 0 && amount_out > 0, "quote has no usable mark");

    let value_ratio = mul_div(out_usd, RATIO, in_usd);     // out$/in$
    let fill_ratio = mul_div(delivered, RATIO, amount_out); // actual/expected
    let kept = mul_div(value_ratio, fill_ratio, RATIO);     // both scaled by 1e9
    if kept >= RATIO {
        return 0; // a quote that cannot lose money
    }
    // (1 - kept/1e9) in bps, rounded UP.
    //
    // Every truncation above makes `kept` smaller, which makes the cost larger,
    // which is the safe direction for a bound. This last division is the one
    // place that would round the other way, so it rounds up explicitly: the
    // number the contract compares against the ceiling is never smaller than
    // the true cost. Here the exact figure is 159.348 bps and the contract
    // says 159 if it truncates, 160 if it rounds up. It must say 160.
    let shortfall = (RATIO - kept) * 10_000; // <= 1e13, no 256-bit path needed
    shortfall.div_ceil(RATIO) as u32
}

/// The cost if the filler delivered only the floor the venue signed — i.e. the
/// guaranteed-worst case. This is the number the exploit demo turns on, and the
/// number a policy engine reading `slippageTolerance` fails to see.
pub fn worst_cost_bps(q: &SignedQuote) -> u32 {
    cost_bps(q, q.min_amount_out.parse().expect("bad minAmountOut"))
}

