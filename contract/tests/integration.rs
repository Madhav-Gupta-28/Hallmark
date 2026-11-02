//! End-to-end against a real NEAR runtime, driven by a real NEAR Intents
//! signature.
//!
//! The fixture is a genuine signed 1Click quote for 5 wNEAR -> ETH with
//! `recipient: hallmark.near`. Because every account it names is a named NEAR
//! account rather than an implicit one, the sandbox can stand up the exact
//! accounts the signature commits to — so nothing here is mocked: the token
//! contracts are real NEP-141s, the transfers are real `ft_transfer_call`s, and
//! the signature is verified by the real `ed25519_verify` host function.

use near_sdk::json_types::U128;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{AccessKey, Account, AccountDetailsPatch, AccountId, Contract, Worker};
use serde_json::json;

const CANONICAL: &str = include_str!("../fixtures/sandbox.canonical.json");
const SIG: &[u8] = include_bytes!("../fixtures/sandbox.sig.bin");

/// The sandbox runs on the real clock, and the fixture carries a real signed
/// `timestamp`, so every mandate here must tolerate however old the capture has
/// become. That is a maintenance fact, not a product default: the client
/// defaults to 300 seconds and `the_freshness_bound_is_exact_to_the_second`
/// pins the arithmetic with a clock it controls. If this suite ever fails with
/// `QuoteTooOld`, the fixture has aged past the contract's own sanity ceiling
/// and needs re-capturing — `fixture_is_still_fresh_enough_to_fill` says so in
/// one line rather than making you read fifteen failures.
const FIXTURE_AGE_BOUND_SECS: u32 = 30 * 86_400;

const ORIGIN: &str = "nep141:wrap.near";
const DESTINATION: &str = "nep141:eth.bridge.near";

/// From the signed fixture.
const AMOUNT_IN: u128 = 5_000_000_000_000_000_000_000_000; // 5 wNEAR, 24 dp
const EXPECTED_OUT: u128 = 9_620_131_019_130_984; // 18 dp
const FLOOR_OUT: u128 = 9_523_929_708_939_674;

fn sig_b58() -> String {
    bs58::encode(SIG).into_string()
}

/// `registrar` can only create dot-free top-level accounts, and `near` is in
/// genesis with a key we do not hold — so `wrap.near` and friends cannot be
/// created the ordinary way. The sandbox's `patch` lets us write the account
/// into state directly, which is the only way to stand up the *exact* accounts
/// a real signature commits to.
/// A patched account's state lands before the node has indexed its access key,
/// so an immediate call can fail with "access key ... has never been observed".
/// Wait for the key to actually be queryable rather than hoping — a test suite
/// a judge is invited to run has to pass every time.
async fn account(w: &Worker<Sandbox>, id: &str) -> anyhow::Result<Account> {
    let sk = SecretKey::from_seed(KeyType::ED25519, id);
    let id: AccountId = id.parse()?;
    w.patch(&id)
        .account(AccountDetailsPatch::default().balance(NearToken::from_near(1_000)))
        .access_key(sk.public_key(), AccessKey::full_access())
        .transact()
        .await?;
    for attempt in 0..40 {
        if w.view_access_key(&id, &sk.public_key()).await.is_ok() {
            return Ok(Account::from_secret_key(id, sk, w));
        }
        tokio::time::sleep(std::time::Duration::from_millis(50 * (attempt + 1).min(6))).await;
    }
    anyhow::bail!("sandbox never indexed the access key for {id}")
}

async fn deploy(w: &Worker<Sandbox>, id: &str, wasm: &[u8]) -> anyhow::Result<Contract> {
    let acct = account(w, id).await?;
    Ok(acct.deploy(wasm).await?.into_result()?)
}

async fn deploy_token(
    w: &Worker<Sandbox>,
    id: &str,
    decimals: u8,
    symbol: &str,
) -> anyhow::Result<Contract> {
    let wasm = std::fs::read("../target/near/test_token/test_token.wasm")?;
    let c = deploy(w, id, &wasm).await?;
    c.call("new")
        .args_json(json!({
            "owner_id": c.id(),
            "total_supply": U128(u128::MAX / 2),
            "decimals": decimals,
            "symbol": symbol,
        }))
        .transact()
        .await?
        .into_result()?;
    Ok(c)
}

struct World {
    worker: Worker<Sandbox>,
    vault: Contract,
    wnear: Contract,
    eth: Contract,
    owner: Account,
    filler: Account,
}

/// Stands up exactly the accounts the signature names:
/// `wrap.near`, `eth.bridge.near`, `hallmark.near`.
async fn setup() -> anyhow::Result<World> {
    let w = near_workspaces::sandbox().await?;

    let wnear = deploy_token(&w, "wrap.near", 24, "wNEAR").await?;
    let eth = deploy_token(&w, "eth.bridge.near", 18, "ETH").await?;
    assert_eq!(wnear.id().as_str(), "wrap.near");
    assert_eq!(eth.id().as_str(), "eth.bridge.near");

    let hallmark_wasm = std::fs::read("../target/near/hallmark/hallmark.wasm")?;
    let vault = deploy(&w, "hallmark.near", &hallmark_wasm).await?;
    vault.call("new").transact().await?.into_result()?;

    let owner = account(&w, "owner.near").await?;
    let filler = account(&w, "filler.near").await?;

    // Whoever creates state pays for it, so both sides prepay. Without this,
    // `open` and `fill` refuse — which is the point of
    // `opening_a_mandate_has_to_be_paid_for` and
    // `a_filler_pays_for_the_state_its_fill_creates`, both of which use fresh
    // accounts precisely so they can observe the refusal.
    for who in [&owner, &filler] {
        who.call(vault.id(), "storage_deposit")
            .args_json(json!({}))
            .deposit(NearToken::from_millinear(500))
            .transact()
            .await?
            .into_result()?;
    }

    // register everyone on both tokens, and fund the two sides
    for t in [&wnear, &eth] {
        for a in [owner.id(), filler.id(), vault.id()] {
            t.call("storage_deposit")
                .args_json(json!({"account_id": a}))
                .deposit(NearToken::from_millinear(10))
                .transact()
                .await?
                .into_result()?;
        }
    }
    wnear
        .call("mint")
        .args_json(json!({"account_id": owner.id(), "amount": U128(AMOUNT_IN * 4)}))
        .transact()
        .await?
        .into_result()?;
    eth.call("mint")
        .args_json(json!({"account_id": filler.id(), "amount": U128(EXPECTED_OUT * 4)}))
        .transact()
        .await?
        .into_result()?;

    Ok(World { worker: w, vault, wnear, eth, owner, filler })
}

/// Open a mandate with terms the caller can bend, so the guards can be probed.
async fn open_with(
    w: &World,
    terms: serde_json::Value,
    amount: u128,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let msg = json!({ "action": "open", "terms": terms }).to_string();
    Ok(w.owner
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(amount), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)
}

fn good_terms(max_cost_bps: u32) -> serde_json::Value {
    json!({
        "origin_asset": ORIGIN,
        "destination_asset": DESTINATION,
        "recipient": "hallmark.near",
        "max_cost_bps": max_cost_bps,
        "max_fill": U128(AMOUNT_IN),
        "max_quote_age_secs": FIXTURE_AGE_BOUND_SECS,
        "expiry_ns": "4000000000000000000",
    })
}

async fn open_mandate(w: &World, max_cost_bps: u32, amount: u128) -> anyhow::Result<()> {
    let msg = json!({
        "action": "open",
        "terms": {
            "origin_asset": ORIGIN,
            "destination_asset": DESTINATION,
            "recipient": "hallmark.near",
            "max_cost_bps": max_cost_bps,
            "max_fill": U128(AMOUNT_IN),
            "max_quote_age_secs": FIXTURE_AGE_BOUND_SECS,
            "expiry_ns": "4000000000000000000",
        }
    })
    .to_string();
    w.owner
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(amount), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// Returns the raw execution outcome so a refusal can be inspected.
async fn try_fill(
    w: &World,
    mandate_id: u64,
    delivered: u128,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let msg = json!({
        "action": "fill",
        "mandate_id": mandate_id,
        "canonical": CANONICAL,
        "signature": sig_b58(),
    })
    .to_string();
    Ok(w.filler
        .call(w.eth.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(delivered), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)
}

async fn credit(w: &World, who: &Account, asset: &str) -> anyhow::Result<u128> {
    Ok(w.vault
        .view("get_credit")
        .args_json(json!({"account_id": who.id(), "asset": asset}))
        .await?
        .json::<U128>()?
        .0)
}

// --------------------------------------------------------------------------

/// The whole product, once: fund, fill, withdraw, with the owner paying the
/// realised cost the venue's own signature implies.
#[tokio::test]
async fn an_owner_funds_a_mandate_a_stranger_fills_it_and_both_withdraw() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;

    let rec = w.vault.view("get_mandate").args_json(json!({"mandate_id": 1})).await?;
    let rec: serde_json::Value = rec.json()?;
    assert_eq!(rec["escrow"], AMOUNT_IN.to_string());
    assert_eq!(rec["owner"], "owner.near");

    // the filler delivers the full expected amount, not merely the floor
    let out = try_fill(&w, 1, EXPECTED_OUT).await?;
    assert!(out.is_success(), "fill failed: {out:#?}");

    // The whole verification — sha256 + ed25519_verify over 681 bytes, the
    // invariant, and both credits — inside one transaction. Recorded so a
    // regression in gas is visible (ARCHITECTURE.md §5.7).
    let tgas = out.total_gas_burnt.as_gas() as f64 / 1e12;
    println!("fill end-to-end: {tgas:.1} TGas");
    assert!(tgas < 100.0, "a fill must fit well inside one transaction, used {tgas:.1} TGas");

    // the owner is credited every unit delivered; the filler earns the input
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, EXPECTED_OUT);
    assert_eq!(credit(&w, &w.filler, ORIGIN).await?, AMOUNT_IN);

    let rec: serde_json::Value =
        w.vault.view("get_mandate").args_json(json!({"mandate_id": 1})).await?.json()?;
    assert_eq!(rec["escrow"], "0");
    assert_eq!(rec["fills"], 1);
    assert_eq!(rec["worst_bps"], 69, "realised cost at the expected fill");

    // both sides pull their own funds
    w.owner
        .call(w.vault.id(), "withdraw")
        .args_json(json!({"asset": DESTINATION}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    w.filler
        .call(w.vault.id(), "withdraw")
        .args_json(json!({"asset": ORIGIN}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let owner_eth: U128 = w
        .eth
        .view("ft_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;
    let filler_wnear: U128 = w
        .wnear
        .view("ft_balance_of")
        .args_json(json!({"account_id": w.filler.id()}))
        .await?
        .json()?;
    assert_eq!(owner_eth.0, EXPECTED_OUT);
    assert_eq!(filler_wnear.0, AMOUNT_IN);
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, 0);
    Ok(())
}

/// The ceiling bites in the real runtime, and the filler's tokens come back.
#[tokio::test]
async fn a_ceiling_the_fill_cannot_meet_refuses_and_refunds_the_filler() -> anyhow::Result<()> {
    let w = setup().await?;
    // the fixture costs 168 bps at its floor and 69 at full delivery
    open_mandate(&w, 50, AMOUNT_IN).await?;

    let before: U128 = w
        .eth
        .view("ft_balance_of")
        .args_json(json!({"account_id": w.filler.id()}))
        .await?
        .json()?;

    let out = try_fill(&w, 1, EXPECTED_OUT).await?;
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains("CostCeilingBreached"), "expected a typed refusal, got {failures}");

    // ft_transfer_call refunds on a failed ft_on_transfer, so the filler is whole
    let after: U128 = w
        .eth
        .view("ft_balance_of")
        .args_json(json!({"account_id": w.filler.id()}))
        .await?
        .json()?;
    assert_eq!(before.0, after.0, "the filler must not lose tokens to a refusal");
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, 0);
    Ok(())
}

/// Delivering below the venue's own signed floor is refused.
#[tokio::test]
async fn delivering_under_the_signed_floor_is_refused() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 10_000, AMOUNT_IN).await?;
    let out = try_fill(&w, 1, FLOOR_OUT - 1).await?;
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains("UnderDelivered"), "got {failures}");
    Ok(())
}

/// An owner can always get unspent escrow back.
#[tokio::test]
async fn an_owner_can_cancel_and_recover_the_unspent_escrow() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    w.owner
        .call(w.vault.id(), "cancel")
        .args_json(json!({"mandate_id": 1}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(credit(&w, &w.owner, ORIGIN).await?, AMOUNT_IN);

    // and a closed mandate cannot be filled
    let out = try_fill(&w, 1, EXPECTED_OUT).await?;
    assert!(format!("{:?}", out.receipt_failures()).contains("closed"));
    Ok(())
}

/// Nobody but the owner can cancel.
#[tokio::test]
async fn a_stranger_cannot_cancel_a_mandate() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    let out = w
        .filler
        .call(w.vault.id(), "cancel")
        .args_json(json!({"mandate_id": 1}))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", out.receipt_failures()).contains("not your mandate"));
    Ok(())
}


// ===================================================================== guards

/// Every guard in `open` refuses, and names itself.
#[tokio::test]
async fn open_refuses_terms_that_could_not_be_enforced() -> anyhow::Result<()> {
    let w = setup().await?;
    let cases: [(&str, serde_json::Value); 8] = [
        ("origin and destination must differ", {
            let mut t = good_terms(200);
            t["destination_asset"] = json!(ORIGIN);
            t
        }),
        ("destination must be a nep141 asset", {
            let mut t = good_terms(200);
            t["destination_asset"] = json!("not-an-asset");
            t
        }),
        ("a ceiling above 100% bounds nothing", {
            let mut t = good_terms(200);
            t["max_cost_bps"] = json!(10_001);
            t
        }),
        ("max_fill must be positive", {
            let mut t = good_terms(200);
            t["max_fill"] = json!(U128(0));
            t
        }),
        ("max_quote_age_secs must be positive", {
            let mut t = good_terms(200);
            t["max_quote_age_secs"] = json!(0);
            t
        }),
        ("max_quote_age_secs above thirty days bounds nothing useful", {
            let mut t = good_terms(200);
            t["max_quote_age_secs"] = json!(31 * 86_400);
            t
        }),
        ("mandate already expired", {
            let mut t = good_terms(200);
            t["expiry_ns"] = json!("1");
            t
        }),
        ("the quote's recipient must be this vault", {
            let mut t = good_terms(200);
            t["recipient"] = json!("someone-else.near");
            t
        }),
    ];
    for (expected, terms) in cases {
        let out = open_with(&w, terms, AMOUNT_IN).await?;
        let failures = format!("{:?}", out.receipt_failures());
        assert!(failures.contains(expected), "expected {expected:?}, got {failures}");
    }
    // and nothing was opened by any of them
    let open: Vec<(u64, serde_json::Value)> =
        w.vault.view("get_mandates").args_json(json!({})).await?.json()?;
    assert!(open.is_empty(), "a refused open must not create a mandate");
    Ok(())
}

/// The origin asset cannot be delivered as if it were the output.
#[tokio::test]
async fn a_fill_in_the_wrong_token_is_refused() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 10_000, AMOUNT_IN).await?;
    let msg = json!({
        "action": "fill", "mandate_id": 1, "canonical": CANONICAL, "signature": sig_b58(),
    })
    .to_string();
    // deliver wNEAR (the ORIGIN) instead of ETH
    let out = w
        .owner
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(1), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", out.receipt_failures()).contains("not the mandate's destination asset"));
    Ok(())
}

// ================================================================== funding

/// `Action::Fund` tops up an existing mandate.
#[tokio::test]
async fn a_mandate_can_be_topped_up_and_the_extra_is_fillable() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;

    let msg = json!({ "action": "fund", "mandate_id": 1 }).to_string();
    w.owner
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(AMOUNT_IN), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let rec: serde_json::Value =
        w.vault.view("get_mandate").args_json(json!({"mandate_id": 1})).await?.json()?;
    assert_eq!(rec["escrow"], (AMOUNT_IN * 2).to_string(), "escrow must have doubled");

    // and the doubled escrow supports two fills of the signed size
    for _ in 0..2 {
        assert!(try_fill(&w, 1, EXPECTED_OUT).await?.is_success());
    }
    let rec: serde_json::Value =
        w.vault.view("get_mandate").args_json(json!({"mandate_id": 1})).await?.json()?;
    assert_eq!(rec["escrow"], "0");
    assert_eq!(rec["fills"], 2);
    assert_eq!(credit(&w, &w.filler, ORIGIN).await?, AMOUNT_IN * 2);
    Ok(())
}

/// Escrow is a hard ceiling: a third fill against a two-fill escrow refuses.
#[tokio::test]
async fn a_fill_beyond_the_escrow_is_refused() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    assert!(try_fill(&w, 1, EXPECTED_OUT).await?.is_success());

    let out = try_fill(&w, 1, EXPECTED_OUT).await?;
    assert!(
        format!("{:?}", out.receipt_failures()).contains("does not hold enough origin asset"),
        "a drained mandate must refuse"
    );
    // the filler's second delivery came back
    assert_eq!(credit(&w, &w.filler, ORIGIN).await?, AMOUNT_IN, "no double credit");
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, EXPECTED_OUT, "no double credit");
    Ok(())
}

/// Funding a closed mandate refuses.
#[tokio::test]
async fn a_closed_mandate_cannot_be_funded() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    w.owner
        .call(w.vault.id(), "cancel")
        .args_json(json!({"mandate_id": 1}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let msg = json!({ "action": "fund", "mandate_id": 1 }).to_string();
    let out = w
        .owner
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(1), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", out.receipt_failures()).contains("closed"));
    Ok(())
}

// ================================================================ withdrawal

/// Withdrawal is pull-only, single-use, and needs the standard 1 yoctoNEAR.
#[tokio::test]
async fn withdrawal_is_single_use_and_guarded() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    assert!(try_fill(&w, 1, EXPECTED_OUT).await?.is_success());

    // no deposit attached
    let out = w
        .owner
        .call(w.vault.id(), "withdraw")
        .args_json(json!({"asset": DESTINATION}))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", out.receipt_failures()).contains("1 yoctoNEAR"));

    // nothing credited in that asset
    let out = w
        .owner
        .call(w.vault.id(), "withdraw")
        .args_json(json!({"asset": ORIGIN}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(format!("{:?}", out.receipt_failures()).contains("nothing to withdraw"));

    // the real one works, exactly once
    for expected_ok in [true, false] {
        let out = w
            .owner
            .call(w.vault.id(), "withdraw")
            .args_json(json!({"asset": DESTINATION}))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?;
        assert_eq!(out.is_success(), expected_ok, "second withdrawal must refuse");
    }
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, 0);
    Ok(())
}

/// If the token transfer fails, the credit is restored rather than lost.
/// Here the owner is unregistered on the destination token, so `ft_transfer`
/// panics and `resolve_withdraw` must put the balance back.
#[tokio::test]
async fn a_failed_transfer_restores_the_credit() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    assert!(try_fill(&w, 1, EXPECTED_OUT).await?.is_success());
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, EXPECTED_OUT);

    // unregister the owner from the ETH contract so the payout cannot land
    w.owner
        .call(w.eth.id(), "storage_unregister")
        .args_json(json!({"force": true}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let out = w
        .owner
        .call(w.vault.id(), "withdraw")
        .args_json(json!({"asset": DESTINATION}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(out.is_success(), "withdraw itself should not abort: {out:#?}");
    assert_eq!(
        credit(&w, &w.owner, DESTINATION).await?,
        EXPECTED_OUT,
        "a failed transfer must restore the credit, not burn it"
    );
    Ok(())
}

// ===================================================================== views

/// The keyless proof surface a judge uses. No key, no funds, no deposit.
#[tokio::test]
async fn the_view_methods_answer_without_a_key() -> anyhow::Result<()> {
    let w = setup().await?;

    let signer: String = w.vault.view("quote_signer").args_json(json!({})).await?.json()?;
    assert_eq!(signer, "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc");

    let signed: bool = w
        .vault
        .view("is_signed")
        .args_json(json!({"canonical": CANONICAL, "signature": sig_b58()}))
        .await?
        .json()?;
    assert!(signed, "the fixture must verify on-chain");

    let tampered = CANONICAL.replacen("\"amountOut\":\"9", "\"amountOut\":\"8", 1);
    let signed: bool = w
        .vault
        .view("is_signed")
        .args_json(json!({"canonical": tampered, "signature": sig_b58()}))
        .await?
        .json()?;
    assert!(!signed, "a tampered quote must not verify");

    let worst: u32 = w.vault.view("worst_cost").args_json(json!({"canonical": CANONICAL})).await?.json()?;
    assert_eq!(worst, 168, "guaranteed-worst cost of the fixture");

    let realised: u32 = w
        .vault
        .view("realised_cost")
        .args_json(json!({"canonical": CANONICAL, "delivered": U128(EXPECTED_OUT)}))
        .await?
        .json()?;
    assert_eq!(realised, 69, "cost at the expected fill");
    assert!(realised < worst, "delivering in full must cost less than the floor");

    // dry_check is what a filler consults before spending anything
    let verdict: String = w
        .vault
        .view("dry_check")
        .args_json(json!({
            "canonical": CANONICAL, "signature": sig_b58(),
            "terms": good_terms(200), "delivered": U128(EXPECTED_OUT)
        }))
        .await?
        .json()?;
    assert!(verdict.starts_with("ALLOWED at 69 bps"), "got {verdict}");

    let verdict: String = w
        .vault
        .view("dry_check")
        .args_json(json!({
            "canonical": CANONICAL, "signature": sig_b58(),
            "terms": good_terms(50), "delivered": U128(EXPECTED_OUT)
        }))
        .await?
        .json()?;
    assert!(verdict.contains("REFUSED CostCeilingBreached"), "got {verdict}");

    let verdict: String = w
        .vault
        .view("dry_check")
        .args_json(json!({
            "canonical": CANONICAL, "signature": "ed25519:not-base58-at-all!!",
            "terms": good_terms(200), "delivered": U128(EXPECTED_OUT)
        }))
        .await?
        .json()?;
    assert!(verdict.contains("REFUSED BadSignature"), "got {verdict}");
    Ok(())
}

/// The order book a filler reads: open mandates only, and cancelling removes one.
#[tokio::test]
async fn get_mandates_lists_only_open_ones() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    open_mandate(&w, 300, AMOUNT_IN).await?;

    let open: Vec<(u64, serde_json::Value)> =
        w.vault.view("get_mandates").args_json(json!({})).await?.json()?;
    assert_eq!(open.len(), 2);
    assert_eq!(open[0].0, 1);
    assert_eq!(open[1].0, 2);
    assert_eq!(open[1].1["terms"]["max_cost_bps"], 300);

    w.owner
        .call(w.vault.id(), "cancel")
        .args_json(json!({"mandate_id": 1}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let open: Vec<(u64, serde_json::Value)> =
        w.vault.view("get_mandates").args_json(json!({})).await?.json()?;
    assert_eq!(open.len(), 1, "a cancelled mandate leaves the book");
    assert_eq!(open[0].0, 2);

    // the cancelled one is still readable by id, and still closed
    let rec: serde_json::Value =
        w.vault.view("get_mandate").args_json(json!({"mandate_id": 1})).await?.json()?;
    assert_eq!(rec["open"], false);
    assert_eq!(rec["escrow"], "0");

    let missing: Option<serde_json::Value> =
        w.vault.view("get_mandate").args_json(json!({"mandate_id": 99})).await?.json()?;
    assert!(missing.is_none());
    Ok(())
}

/// Cancelling after a partial fill returns only what is left.
#[tokio::test]
async fn cancel_after_a_fill_returns_only_the_remainder() -> anyhow::Result<()> {
    let w = setup().await?;
    // escrow for two fills, then fill once and cancel
    open_mandate(&w, 200, AMOUNT_IN * 2).await?;
    assert!(try_fill(&w, 1, EXPECTED_OUT).await?.is_success());

    w.owner
        .call(w.vault.id(), "cancel")
        .args_json(json!({"mandate_id": 1}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    assert_eq!(credit(&w, &w.owner, ORIGIN).await?, AMOUNT_IN, "only the unspent escrow");
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, EXPECTED_OUT, "the fill is untouched");
    assert_eq!(credit(&w, &w.filler, ORIGIN).await?, AMOUNT_IN);
    Ok(())
}

// ============================================================ freshness (§2.10)

/// A validly signed quote, inside its own deadline, refused on-chain because it
/// is older than the mandate allows.
///
/// This is the hole v1 shipped. `deadline` is chosen by whoever asks for the
/// quote — 1Click signs one ten years out on a free `dry: true` request — so a
/// filler could mint a library of signed quotes for nothing, wait for the market
/// to move, and exercise whichever had become profitable. The ceiling would
/// still pass, because it is computed from USD marks frozen at signing time.
#[tokio::test]
async fn a_quote_older_than_the_mandate_allows_is_refused_on_chain() -> anyhow::Result<()> {
    let w = setup().await?;

    // The signature is good and the deadline is years away...
    let signed: bool = w
        .vault
        .view("is_signed")
        .args_json(json!({"canonical": CANONICAL, "signature": sig_b58()}))
        .await?
        .json()?;
    assert!(signed);

    // ...but this mandate only accepts quotes signed in the last second.
    let mut terms = good_terms(10_000);
    terms["max_quote_age_secs"] = json!(1);
    open_with(&w, terms, AMOUNT_IN).await?.into_result()?;

    let out = try_fill(&w, 1, EXPECTED_OUT).await?;
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains("QuoteTooOld"), "expected QuoteTooOld, got {failures}");

    // the filler lost nothing and the escrow is untouched
    assert_eq!(credit(&w, &w.filler, ORIGIN).await?, 0);
    let rec: serde_json::Value =
        w.vault.view("get_mandate").args_json(json!({"mandate_id": 1})).await?.json()?;
    assert_eq!(rec["escrow"], AMOUNT_IN.to_string());
    assert_eq!(rec["fills"], 0);
    Ok(())
}

/// `quote_age_secs` is the number the bound is enforced against, readable by
/// anyone. If this test fails, the captured fixture has aged past the contract's
/// sanity ceiling and needs re-capturing — nothing else is wrong.
#[tokio::test]
async fn fixture_is_still_fresh_enough_to_fill() -> anyhow::Result<()> {
    let w = setup().await?;
    let age: near_sdk::json_types::U64 = w
        .vault
        .view("quote_age_secs")
        .args_json(json!({"canonical": CANONICAL}))
        .await?
        .json()?;
    assert!(
        age.0 < FIXTURE_AGE_BOUND_SECS as u64,
        "the signed fixture is {} days old, past the {} day ceiling. \n       \
         Re-capture it with `npm run bound -- NEAR ETH 5 --json`; nothing is broken.",
        age.0 / 86_400,
        FIXTURE_AGE_BOUND_SECS / 86_400,
    );
    Ok(())
}

// ============================================================== storage (§2.11)

/// Opening a mandate costs the account that opens it, not the vault.
///
/// Without this the vault staked NEAR for every mandate any stranger created,
/// at roughly ten times the attacker's gas cost — about ten cents to make a
/// live vault unable to write state at all, fills and withdrawals included.
#[tokio::test]
async fn opening_a_mandate_has_to_be_paid_for() -> anyhow::Result<()> {
    let w = setup().await?;
    let stranger = account(&w.worker, "stranger.near").await?;
    w.wnear
        .call("storage_deposit")
        .args_json(json!({"account_id": stranger.id()}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    w.wnear
        .call("mint")
        .args_json(json!({"account_id": stranger.id(), "amount": U128(AMOUNT_IN)}))
        .transact()
        .await?
        .into_result()?;

    // No prepaid storage: refused, and the tokens come back.
    let msg = json!({ "action": "open", "terms": good_terms(200) }).to_string();
    let out = stranger
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(AMOUNT_IN), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains("prepay storage first"), "got {failures}");
    let back: U128 = w
        .wnear
        .view("ft_balance_of")
        .args_json(json!({"account_id": stranger.id()}))
        .await?
        .json()?;
    assert_eq!(back.0, AMOUNT_IN, "a refused open must refund the transfer");

    // Prepay the recommended amount, and it works.
    let estimate: U128 = w.vault.view("storage_cost_estimate").args_json(json!({})).await?.json()?;
    let credited: U128 = stranger
        .call(w.vault.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(estimate.0))
        .transact()
        .await?
        .json()?;
    // Less than deposited, because the deposit paid for its own ledger entry.
    assert!(
        credited.0 > 0 && credited.0 < estimate.0,
        "a deposit of {} credited {}, which should be less by the entry's own cost",
        estimate.0,
        credited.0
    );
    println!(
        "  storage_cost_estimate {} -> credited {} (its ledger entry cost {} bytes)",
        estimate.0,
        credited.0,
        (estimate.0 - credited.0) / 10u128.pow(19)
    );

    // Opening charges the measured cost of the record, and no more.
    let bytes0 = w.vault.view_account().await?.storage_usage;
    stranger
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(AMOUNT_IN), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let bytes1 = w.vault.view_account().await?.storage_usage;
    let left: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": stranger.id()}))
        .await?
        .json()?;
    let grew = (bytes1 - bytes0) as u128 * 10u128.pow(19);
    println!("  opening grew the vault {} bytes; the opener was charged for {} bytes",
             bytes1 - bytes0, (credited.0 - left.0) / 10u128.pow(19));
    assert_eq!(credited.0 - left.0, grew, "charged exactly what the record cost");
    assert!(left.0 > 0, "the recommendation leaves change, which storage_withdraw returns");
    Ok(())
}

/// A withdrawal releases its credit slot rather than leaving a zero behind, so
/// an honest round trip is storage-neutral and a filler cannot mint slots the
/// vault paid for.
#[tokio::test]
async fn a_withdrawal_releases_the_storage_it_was_using() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 10_000, AMOUNT_IN).await?;
    try_fill(&w, 1, EXPECTED_OUT).await?.into_result()?;

    let with_credits = w.vault.view_account().await?.storage_usage;
    for (who, asset) in [(&w.owner, DESTINATION), (&w.filler, ORIGIN)] {
        who.call(w.vault.id(), "withdraw")
            .args_json(json!({"asset": asset}))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let after = w.vault.view_account().await?.storage_usage;
    assert!(
        after < with_credits,
        "withdrawing left {after} bytes, was {with_credits} — the slot was zeroed, not removed"
    );
    assert_eq!(credit(&w, &w.owner, DESTINATION).await?, 0);
    assert_eq!(credit(&w, &w.filler, ORIGIN).await?, 0);
    Ok(())
}

/// **The invariant, measured.** Whatever the vault's state grew by, somebody
/// paid for exactly that — never the vault itself.
///
/// This is the test that would have caught both earlier versions of the §2.11
/// fix. The first let the vault stake NEAR for any mandate a stranger opened.
/// The second charged a fixed 1,536 bytes and gave all of it back on `cancel`
/// while the record stayed, so open/cancel in a loop still cost the vault 296
/// bytes a go. Both are failures of the same assertion: measure the vault, and
/// measure the payer, and insist they agree.
#[tokio::test]
async fn the_vault_never_pays_for_state_someone_else_created() -> anyhow::Result<()> {
    let w = setup().await?;
    let paid0: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;
    let bytes0 = w.vault.view_account().await?.storage_usage;

    for id in 1..=3u64 {
        open_mandate(&w, 200, AMOUNT_IN / 4).await?;
        w.owner
            .call(w.vault.id(), "cancel")
            .args_json(json!({"mandate_id": id}))
            .transact()
            .await?
            .into_result()?;
    }

    let paid1: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;
    let bytes1 = w.vault.view_account().await?.storage_usage;
    let grew = (bytes1 - bytes0) as u128 * 10u128.pow(19);
    let spent = paid0.0 - paid1.0;
    println!("  3 open+cancel cycles: vault grew {grew} yocto of storage, owner paid {spent}");
    assert_eq!(
        spent, grew,
        "exact accounting: the owner must pay for precisely what the vault grew by"
    );
    Ok(())
}

/// The same assertion across a *fill*, where the state is created by somebody
/// other than the mandate's owner.
///
/// A fill creates credit slots, so without this the vault would stake NEAR for
/// state a filler caused — and a filler can cause a lot of it, bounded only by
/// the escrow. The filler settles for its own fills.
#[tokio::test]
async fn a_filler_pays_for_the_state_its_fill_creates() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 10_000, AMOUNT_IN).await?;

    // A filler nobody has heard of, holding inventory but no prepaid storage.
    let stranger = account(&w.worker, "stranger-filler.near").await?;
    w.eth
        .call("storage_deposit")
        .args_json(json!({"account_id": stranger.id()}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    w.eth
        .call("mint")
        .args_json(json!({"account_id": stranger.id(), "amount": U128(EXPECTED_OUT * 2)}))
        .transact()
        .await?
        .into_result()?;
    let fill_msg = json!({
        "action": "fill", "mandate_id": 1, "canonical": CANONICAL, "signature": sig_b58(),
    })
    .to_string();
    let deliver = |who: &Account| {
        who.call(w.eth.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": w.vault.id(), "amount": U128(EXPECTED_OUT), "msg": fill_msg
            }))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
    };

    // No prepaid storage: refused, and the delivery comes back.
    let out = deliver(&stranger).transact().await?;
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains("prepay storage first"), "got {failures}");
    let back: U128 = w
        .eth
        .view("ft_balance_of")
        .args_json(json!({"account_id": stranger.id()}))
        .await?
        .json()?;
    assert_eq!(back.0, EXPECTED_OUT * 2, "a refused fill must refund the delivery");

    // Prepay, and the fill lands — charged for exactly what it created.
    stranger
        .call(w.vault.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?;
    let paid0: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": stranger.id()}))
        .await?
        .json()?;
    let bytes0 = w.vault.view_account().await?.storage_usage;

    deliver(&stranger).transact().await?.into_result()?;

    let paid1: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": stranger.id()}))
        .await?
        .json()?;
    let bytes1 = w.vault.view_account().await?.storage_usage;
    let grew = (bytes1 - bytes0) as u128 * 10u128.pow(19);
    let spent = paid0.0 - paid1.0;
    println!("  one fill: vault grew {grew} yocto of storage, filler paid {spent}");
    assert_eq!(spent, grew, "the filler must pay for precisely what its fill created");
    assert!(grew > 0, "a fill does create state - two credit slots");
    Ok(())
}

/// Topping up an existing mandate creates no state, so it costs nothing.
#[tokio::test]
async fn funding_a_mandate_creates_no_state_and_is_charged_nothing() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;
    let paid0: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;

    let msg = json!({ "action": "fund", "mandate_id": 1 }).to_string();
    w.owner
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(AMOUNT_IN), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let paid1: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;
    assert_eq!(paid1.0, paid0.0, "fund writes no new state, so it must cost nothing");
    Ok(())
}

/// A storage deposit pays for its own ledger entry, so that entry is not
/// subsidised by the vault either.
#[tokio::test]
async fn a_storage_deposit_pays_for_its_own_ledger_entry() -> anyhow::Result<()> {
    let w = setup().await?;
    let fresh = account(&w.worker, "fresh.near").await?;
    let bytes0 = w.vault.view_account().await?.storage_usage;
    let deposit = NearToken::from_millinear(10).as_yoctonear();

    let credited: U128 = fresh
        .call(w.vault.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(deposit))
        .transact()
        .await?
        .json()?;
    let bytes1 = w.vault.view_account().await?.storage_usage;
    let entry = (bytes1 - bytes0) as u128 * 10u128.pow(19);
    println!("  a ledger entry is {} bytes; credited {} of {deposit}", bytes1 - bytes0, credited.0);
    assert!(entry > 0, "the entry is real state");
    assert_eq!(credited.0, deposit - entry, "the deposit must pay for its own entry");
    Ok(())
}

/// `reap` deletes a closed record and returns the storage that actually went
/// away — never more than was paid for it.
#[tokio::test]
async fn reaping_returns_only_the_storage_it_actually_frees() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;

    // `cancel` settles the net measured delta like everything else: it removes
    // the open-id index entry and may create a credit slot for the escrow, so
    // it can land either way. What it must NOT do is hand back the record's
    // storage, because the record is still there.
    let before: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;
    let bytes0 = w.vault.view_account().await?.storage_usage;
    w.owner
        .call(w.vault.id(), "cancel")
        .args_json(json!({"mandate_id": 1}))
        .transact()
        .await?
        .into_result()?;
    let after_cancel: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;
    let bytes1 = w.vault.view_account().await?.storage_usage;
    let settled = after_cancel.0 as i128 - before.0 as i128;
    let shrank = (bytes0 as i128 - bytes1 as i128) * 10i128.pow(19);
    println!("  cancel: vault changed by {} bytes, owner settled {}",
             bytes1 as i128 - bytes0 as i128, settled);
    assert_eq!(settled, shrank, "cancel settles exactly the net measured delta");
    assert!(
        w.vault
            .view("get_mandate")
            .args_json(json!({"mandate_id": 1}))
            .await?
            .json::<Option<serde_json::Value>>()?
            .is_some(),
        "a cancelled mandate stays readable - it is its own receipt"
    );

    // reaping frees the bytes and returns them
    let bytes_before = w.vault.view_account().await?.storage_usage;
    let refund: U128 = w
        .owner
        .call(w.vault.id(), "reap")
        .args_json(json!({"mandate_id": 1}))
        .transact()
        .await?
        .json()?;
    let bytes_after = w.vault.view_account().await?.storage_usage;
    let freed = (bytes_before - bytes_after) as u128 * 10u128.pow(19);
    println!("  reap freed {freed} yocto of storage and refunded {}", refund.0);
    assert!(refund.0 > 0, "reaping must return something");
    assert_eq!(refund.0, freed, "reaping returns precisely the bytes it freed");
    assert!(
        w.vault
            .view("get_mandate")
            .args_json(json!({"mandate_id": 1}))
            .await?
            .json::<Option<serde_json::Value>>()?
            .is_none(),
        "a reaped mandate is gone"
    );

    // and only once
    let out = w
        .owner
        .call(w.vault.id(), "reap")
        .args_json(json!({"mandate_id": 1}))
        .transact()
        .await?;
    assert!(out.is_failure(), "reaping twice must refuse");
    Ok(())
}

/// Only the owner may reap, and only a closed mandate.
#[tokio::test]
async fn reap_is_owner_only_and_needs_a_closed_mandate() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;

    let out = w
        .owner
        .call(w.vault.id(), "reap")
        .args_json(json!({"mandate_id": 1}))
        .transact()
        .await?;
    assert!(format!("{:?}", out.failures()).contains("cancel the mandate first"));

    w.owner
        .call(w.vault.id(), "cancel")
        .args_json(json!({"mandate_id": 1}))
        .transact()
        .await?
        .into_result()?;
    let out = w
        .filler
        .call(w.vault.id(), "reap")
        .args_json(json!({"mandate_id": 1}))
        .transact()
        .await?;
    assert!(format!("{:?}", out.failures()).contains("not your mandate"));
    Ok(())
}

/// `storage_withdraw` gives back what no mandate is using.
#[tokio::test]
async fn unused_prepaid_storage_can_be_taken_back() -> anyhow::Result<()> {
    let w = setup().await?;
    let prepaid: U128 = w
        .vault
        .view("storage_balance_of")
        .args_json(json!({"account_id": w.owner.id()}))
        .await?
        .json()?;
    assert!(prepaid.0 > 0);
    w.owner
        .call(w.vault.id(), "storage_withdraw")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(
        w.vault
            .view("storage_balance_of")
            .args_json(json!({"account_id": w.owner.id()}))
            .await?
            .json::<U128>()?
            .0,
        0
    );
    // and now an open refuses, because nothing is prepaid
    let out = open_with(&w, good_terms(200), AMOUNT_IN).await?;
    assert!(format!("{:?}", out.receipt_failures()).contains("prepay storage first"));
    Ok(())
}

// ================================================================ fund guards

/// `fund` is for the owner, on a live mandate. A stranger topping up someone
/// else's mandate is a gift with no mechanism behind it, and an expired mandate
/// can never be filled — so both are mistakes rather than features.
#[tokio::test]
async fn only_the_owner_can_fund_and_only_a_live_mandate() -> anyhow::Result<()> {
    let w = setup().await?;
    open_mandate(&w, 200, AMOUNT_IN).await?;

    // a stranger cannot fund it
    w.wnear
        .call("mint")
        .args_json(json!({"account_id": w.filler.id(), "amount": U128(AMOUNT_IN)}))
        .transact()
        .await?
        .into_result()?;
    let msg = json!({ "action": "fund", "mandate_id": 1 }).to_string();
    let out = w
        .filler
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(AMOUNT_IN), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains("only the owner can fund"), "got {failures}");
    let back: U128 = w
        .wnear
        .view("ft_balance_of")
        .args_json(json!({"account_id": w.filler.id()}))
        .await?
        .json()?;
    assert_eq!(back.0, AMOUNT_IN, "a refused fund must refund the transfer");

    // an expired mandate cannot be funded either
    let mut terms = good_terms(200);
    let now_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos() as u64;
    terms["expiry_ns"] = json!((now_ns + 3_000_000_000).to_string());
    open_with(&w, terms, AMOUNT_IN).await?.into_result()?;
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    let msg = json!({ "action": "fund", "mandate_id": 2 }).to_string();
    let out = w
        .owner
        .call(w.wnear.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.vault.id(), "amount": U128(AMOUNT_IN), "msg": msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    let failures = format!("{:?}", out.receipt_failures());
    assert!(failures.contains("mandate has expired"), "got {failures}");
    Ok(())
}

// ============================================================ the order book

/// `get_mandates` reads an index of open ids, so what the order book costs
/// tracks what the vault holds rather than what it remembers (§2.12).
///
/// Before the index, this call walked every mandate ever created and discarded
/// the closed ones — so the only way a filler can find work got steadily more
/// expensive as the vault succeeded, and would eventually exceed a view call's
/// gas budget. This asserts the index and the records never disagree.
async fn book(w: &World) -> anyhow::Result<(u32, Vec<(u64, serde_json::Value)>, u64)> {
    let open: u32 = w.vault.view("open_mandate_count").args_json(json!({})).await?.json()?;
    let listed: Vec<(u64, serde_json::Value)> =
        w.vault.view("get_mandates").args_json(json!({})).await?.json()?;
    let ever: u64 = w.vault.view("mandate_count").args_json(json!({})).await?.json()?;
    Ok((open, listed, ever))
}

#[tokio::test]
async fn the_order_book_tracks_what_is_open_not_what_ever_existed() -> anyhow::Result<()> {
    let w = setup().await?;
    let small = AMOUNT_IN / 16;
    for _ in 0..8 {
        open_mandate(&w, 200, small).await?;
    }
    let (open, listed, ever) = book(&w).await?;
    assert_eq!((open, ever), (8, 8));
    assert_eq!(listed.len(), 8);
    assert_eq!(listed.iter().map(|(id, _)| *id).collect::<Vec<_>>(), (1..=8).collect::<Vec<_>>());

    // close seven of the eight
    for id in 1..=7u64 {
        w.owner
            .call(w.vault.id(), "cancel")
            .args_json(json!({"mandate_id": id}))
            .transact()
            .await?
            .into_result()?;
    }
    let (open, listed, ever) = book(&w).await?;
    println!("  8 opened, 7 closed -> order book holds {open}, vault remembers {ever}");
    assert_eq!(open, 1, "the index holds only the open one");
    assert_eq!(ever, 8, "ids are never reused");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].0, 8);

    // reaping a closed one does not disturb the book
    w.owner
        .call(w.vault.id(), "reap")
        .args_json(json!({"mandate_id": 3}))
        .transact()
        .await?
        .into_result()?;
    let (open, listed, ever) = book(&w).await?;
    assert_eq!((open, ever, listed.len()), (1, 8, 1));

    // and pagination works off the index
    open_mandate(&w, 200, small).await?;
    let page: Vec<(u64, serde_json::Value)> = w
        .vault
        .view("get_mandates")
        .args_json(json!({"from_index": 1, "limit": 1}))
        .await?
        .json()?;
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].0, 9, "from_index pages the open set, in id order");
    Ok(())
}
