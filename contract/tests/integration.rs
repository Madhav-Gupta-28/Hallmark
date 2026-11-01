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
async fn account(w: &Worker<Sandbox>, id: &str) -> anyhow::Result<Account> {
    let sk = SecretKey::from_seed(KeyType::ED25519, id);
    let id: AccountId = id.parse()?;
    w.patch(&id)
        .account(AccountDetailsPatch::default().balance(NearToken::from_near(1_000)))
        .access_key(sk.public_key(), AccessKey::full_access())
        .transact()
        .await?;
    Ok(Account::from_secret_key(id, sk, w))
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

    // register everyone on both tokens, and fund the two sides
    for t in [&wnear, &eth] {
        for a in [owner.id(), filler.id(), vault.id()] {
            t.call("storage_deposit")
                .args_json(json!({"account_id": a}))
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

    Ok(World { vault, wnear, eth, owner, filler })
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
            "expiry_ns": 4_000_000_000_000_000_000u64,
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
