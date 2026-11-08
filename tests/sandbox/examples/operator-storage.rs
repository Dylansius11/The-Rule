//! Actual local WASM: protect player principal while admitting a funded round.
#[path = "../tests/common/mod.rs"]
mod common;
use common::*;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{Value, json};
use std::time::Duration;
const BYTE: u128 = 10_000_000_000_000_000_000;
fn amount(v: &Value, field: &str) -> u128 {
    v[field].as_str().unwrap().parse().unwrap()
}

#[tokio::main]
async fn main() -> Res<()> {
    println!("LOCAL OPERATOR STORAGE: actual WASM, MOCK OutLayer, no testnet");
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let mock = worker
        .dev_deploy(&std::fs::read(sandbox_tests::artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let wasm = std::fs::read(sandbox_tests::artifact("game"))?;
    let account = root
        .create_subaccount("reserve-game")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let game = account.deploy(&wasm).await?.into_result()?;
    let config = sandbox_tests::params(mock.id().as_str());
    root.call(game.id(), "new")
        .args_json(json!({"params":config,"demo":true}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    // Flush deployment gas-refund receipts before sizing unallocated liquidity.
    // Subsequent setup calls are signed by root/player, never by this game account.
    worker.fast_forward(10).await?;
    // Deployment burns signer gas. Fund that normally, then use this explicitly
    // key-retaining local fixture's own key to remove only unallocated surplus.
    // No state patch, callback impersonation, or production recovery is involved.
    let initial: Value = game.view("get_ledger").await?.json()?;
    let target = amount(&initial, "operator_storage_required") + 1024 * BYTE
        - NearToken::from_millinear(50).as_yoctonear();
    let surplus = amount(&initial, "operator_storage_available") - target;
    account
        .transfer_near(root.id(), NearToken::from_yoctonear(surplus))
        .await?
        .into_result()?;
    let player = worker.dev_create_account().await?;
    player
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    player
        .call(game.id(), "seed_pot")
        .args_json(json!({"mode":0}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let before: Value = game.view("get_ledger").await?.json()?;
    let required = amount(&before, "operator_storage_required") + 1024 * BYTE;
    let available = amount(&before, "operator_storage_available");
    println!(
        "OPERATOR fixture: initial={initial}, target={target}, removed_surplus={surplus}, before={before}, required_next={required}"
    );
    assert!(
        available < required,
        "fixture must lack operator collateral, despite player/pot funds"
    );
    let failure = player
        .call(game.id(), "start_round")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?
        .into_result()
        .expect_err("unfunded operator must reject");
    assert!(format!("{failure:?}").contains("E24"));
    let after: Value = game.view("get_ledger").await?.json()?;
    for field in [
        "credit",
        "vault",
        "round_pots",
        "carry",
        "compute_float",
        "platform_accrued",
        "storage_reserve",
        "pending_credit",
        "pending_referee_requests",
    ] {
        assert_eq!(before[field], after[field], "E24 changed {field}");
    }
    let count: String = mock.view("request_count").await?.json()?;
    assert_eq!(count, "0");
    let absent: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":null}))
        .await?
        .json()?;
    assert!(absent.is_null());
    // Plain operator top-up is deliberately unallocated: not credit, compute or seed.
    let top_up = required - amount(&after, "operator_storage_available") + BYTE;
    root.transfer_near(game.id(), NearToken::from_yoctonear(top_up))
        .await?
        .into_result()?;
    let funded: Value = game.view("get_ledger").await?.json()?;
    assert_eq!(funded["credit"], before["credit"]);
    assert_eq!(funded["carry"], before["carry"]);
    let begin = player
        .call(game.id(), "start_round")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 1).await?;
    resolve(&mock, 0, begin_value(&"11".repeat(32)), false).await?;
    begin.await?.into_result()?;
    let mut began = false;
    for _ in 0..50 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":0}))
            .await?
            .json()?;
        if round["phase"] == "Investigation" {
            began = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(began);
    let settled: Value = game.view("get_ledger").await?.json()?;
    assert_eq!(settled["credit"], before["credit"]);
    assert_eq!(settled["round_pots"], before["carry"]);
    assert_eq!(amount(&settled, "operator_storage_required"), required);
    println!(
        "OPERATOR PASS: E24 preserved principal and created no request; unallocated top-up={top_up} yocto admitted one round; required={required}, prior_available={available}"
    );
    Ok(())
}
