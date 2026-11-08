//! Real local game/token fault paths with a MOCK OutLayer; not testnet evidence.
//! Build sandbox artifacts first, then run: cargo run -p sandbox-tests --profile fast --example token-failure
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{Value, json};
use std::time::Duration;

const RULE: u128 = 1_000_000_000_000_000_000;
const ALLOWANCE: u128 = 500_000 * RULE;

fn rpc(worker: &Worker<Sandbox>, method: &str, params: Value) -> Res<Value> {
    let body = json!({"jsonrpc":"2.0","id":"token-failure","method":method,"params":params});
    let output = std::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            "15",
            "--noproxy",
            "*",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
        ])
        .arg(body.to_string())
        .arg(worker.rpc_addr())
        .output()?;
    if !output.status.success() {
        return Err(format!("{method}: {}", String::from_utf8_lossy(&output.stderr)).into());
    }
    let response: Value = serde_json::from_slice(&output.stdout)?;
    if let Some(error) = response.get("error") {
        return Err(format!("{method}: {error}").into());
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| format!("{method}: missing result").into())
}

// A detached call's transaction status is insufficient: match the action to its
// receipt id, predecessor, receiver and execution status in the original tx graph.
async fn trace(
    worker: &Worker<Sandbox>,
    result: &ExecutionFinalResult,
    sender: &str,
    game: &Contract,
    token: &Contract,
    expected: (&str, bool, &str, Option<&str>),
) -> Res<()> {
    let (method, external_success, callback, expected_return) = expected;
    if !result.is_success() {
        return Err(format!("initiating transaction failed: {result:?}").into());
    }
    let tx = result.outcome().transaction_hash.to_string();
    for _ in 0..100 {
        let tx_status = rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({
                "tx_hash":tx,"sender_account_id":sender,"wait_until":"INCLUDED"
            }),
        )?;
        let mut external = false;
        let mut completed = false;
        if let Some(outcomes) = tx_status["receipts_outcome"].as_array() {
            for outcome in outcomes {
                let Some(id) = outcome["id"].as_str() else {
                    continue;
                };
                let receipt = rpc(worker, "EXPERIMENTAL_receipt", json!({"receipt_id":id}))?;
                if receipt["receipt_id"] != id
                    || receipt["receiver_id"] != outcome["outcome"]["executor_id"]
                {
                    return Err(format!("receipt identity mismatch: {id}").into());
                }
                let Some(actions) = receipt["receipt"]["Action"]["actions"].as_array() else {
                    continue;
                };
                for action in actions {
                    let call = &action["FunctionCall"];
                    let is_external = call["method_name"] == method
                        && receipt["predecessor_id"] == game.id().as_str()
                        && receipt["receiver_id"] == token.id().as_str();
                    let is_callback = call["method_name"] == callback
                        && receipt["predecessor_id"] == game.id().as_str()
                        && receipt["receiver_id"] == game.id().as_str();
                    if !is_external && !is_callback {
                        continue;
                    }
                    let status = &outcome["outcome"]["status"];
                    let success = status.get("SuccessValue").is_some()
                        || status.get("SuccessReceiptId").is_some();
                    if !success {
                        return Err(format!("unexpected receipt status {id}: {status}").into());
                    }
                    let allocated = if is_callback && callback != "on_mint" {
                        60_000_000_000_000u64
                    } else {
                        10_000_000_000_000u64
                    };
                    if call["gas"].as_u64() != Some(allocated) {
                        return Err(format!(
                            "unexpected gas allocation for receipt {id}: {}",
                            call["gas"]
                        )
                        .into());
                    }
                    if is_external && method == "execute_operation" {
                        check_token_outcome(
                            call,
                            status,
                            if callback == "on_mint" {
                                "mint"
                            } else {
                                "unlock"
                            },
                            external_success,
                        )?;
                    }
                    if is_external {
                        if let Some(value) = expected_return
                            && status["SuccessValue"] != value
                        {
                            return Err(format!("unexpected return for {method}: {status}").into());
                        }
                        external = true;
                    } else {
                        completed = true;
                    }
                    println!(
                        "ACTION tx={tx} receipt={id} method={} status={status} allocated_gas={} burnt_gas={}",
                        call["method_name"], call["gas"], outcome["outcome"]["gas_burnt"]
                    );
                }
            }
        }
        if external && completed {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("tx {tx}: missing {method} or {callback} receipt").into())
}

async fn state(game: &Contract, alice: &Account) -> Res<String> {
    Ok(game
        .view("get_token_state")
        .args_json(json!({"account":alice.id()}))
        .await?
        .json()?)
}
async fn token_balance(token: &Contract, account: &str) -> Res<u128> {
    let amount: String = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":account}))
        .await?
        .json()?;
    Ok(amount.parse()?)
}
async fn locked(game: &Contract, alice: &Account) -> Res<u128> {
    let amount: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":1,"account":alice.id()}))
        .await?
        .json()?;
    Ok(amount.parse()?)
}
async fn reconcile(
    game: &Contract,
    token: &Contract,
    expected_allowance: u128,
    expected: &[u128],
) -> Res<()> {
    let round: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    assert_eq!(round["allowance_left"], expected_allowance.to_string());
    let rows: Vec<Value> = game
        .view("get_log")
        .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
        .await?
        .json()?;
    assert_eq!(rows.len(), expected.len());
    for (row, amount) in rows.iter().zip(expected) {
        assert_eq!(row["verdict"], true);
        assert_eq!(row["minted"], amount.to_string());
    }
    let supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(supply.parse::<u128>()?, expected.iter().sum::<u128>());
    Ok(())
}
async fn register_storage(alice: &Account, token: &Contract, minimum: u128) -> Res<()> {
    alice
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":alice.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(minimum))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}
async fn unregister(alice: &Account, token: &Contract) -> Res<()> {
    let removed: bool = alice
        .call(token.id(), "storage_unregister")
        .args_json(json!({"force":false}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert!(removed);
    Ok(())
}

#[tokio::main]
async fn main() -> Res<()> {
    println!("LOCAL SANDBOX: real game/token, MOCK OutLayer; no testnet or real OutLayer");
    let worker = near_workspaces::sandbox().await?;
    let mock = worker
        .dev_deploy(&std::fs::read(sandbox_tests::artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let game = worker
        .dev_deploy(&std::fs::read(sandbox_tests::artifact("game"))?)
        .await?;
    let token = worker
        .dev_deploy(&std::fs::read(sandbox_tests::artifact("token"))?)
        .await?;
    token
        .call("new")
        .args_json(
            json!({"minter":game.id(),"cap":"1000000000000000000000000000",
        "metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}}),
        )
        .transact()
        .await?
        .into_result()?;
    fund_token_operations(&token).await?;
    let mut config = sandbox_tests::params(mock.id().as_str());
    config["token"] = json!(token.id());
    config["base_attempts"] = json!([3, 50]);
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 1).await?;
    resolve(&mock, 0, begin_value(&"11".repeat(32)), false).await?;
    begin.await?.into_result()?;
    let mut investigating = false;
    for _ in 0..50 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":0}))
            .await?
            .json()?;
        if round["phase"] == "Investigation" {
            investigating = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if !investigating {
        return Err("round never reached Investigation".into());
    }
    let alice = worker.dev_create_account().await?;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let initial_credit = credit(&game, &alice).await?;
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let minimum: u128 = bounds["min"].as_str().ok_or("missing minimum")?.parse()?;
    alice
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":game.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(minimum))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    // The token executes successfully but returns JSON null: registration fails without a debit.
    let check = alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?;
    trace(
        &worker,
        &check,
        alice.id().as_str(),
        &game,
        &token,
        ("storage_balance_of", true, "on_register", Some("bnVsbA==")),
    )
    .await?;
    assert_eq!(state(&game, &alice).await?, "none");
    assert_eq!(credit(&game, &alice).await?, initial_credit);
    register_storage(&alice, &token, minimum).await?;
    let check = alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?;
    trace(
        &worker,
        &check,
        alice.id().as_str(),
        &game,
        &token,
        ("storage_balance_of", true, "on_register", None),
    )
    .await?;
    assert_eq!(state(&game, &alice).await?, "registered");
    assert_eq!(credit(&game, &alice).await?, initial_credit);

    // Unregister after the successful game check while the token balance is zero.
    unregister(&alice, &token).await?;
    assert_eq!(state(&game, &alice).await?, "registered");
    for (id, number, success) in [(1, 2, false), (2, 3, true)] {
        if success {
            register_storage(&alice, &token, minimum).await?;
        }
        let play = alice
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":number,"word":"otter"}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, id + 1).await?;
        resolve(&mock, id, json!({"v":1}), false).await?;
        let result = play.await?;
        trace(
            &worker,
            &result,
            alice.id().as_str(),
            &game,
            &token,
            ("execute_operation", success, "on_mint", None),
        )
        .await?;
        if success {
            reconcile(&game, &token, ALLOWANCE - 100 * RULE, &[0, 100 * RULE]).await?;
            assert_eq!(
                token_balance(&token, alice.id().as_str()).await?,
                100 * RULE
            );
        } else {
            reconcile(&game, &token, ALLOWANCE, &[0]).await?;
            assert_eq!(token_balance(&token, alice.id().as_str()).await?, 0);
        }
    }

    // Move all minted tokens into a future lock; now the owner can unregister without burning.
    let amount = 100 * RULE;
    alice
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":game.id(),"amount":amount.to_string(),
        "msg":json!({"lock":{"mode":0,"round_id":1}}).to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(locked(&game, &alice).await?, amount);
    assert_eq!(token_balance(&token, alice.id().as_str()).await?, 0);
    assert_eq!(token_balance(&token, game.id().as_str()).await?, amount);
    unregister(&alice, &token).await?;
    let first = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":1}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    trace(
        &worker,
        &first,
        alice.id().as_str(),
        &game,
        &token,
        ("execute_operation", false, "on_unlock", None),
    )
    .await?;
    assert_eq!(locked(&game, &alice).await?, amount);
    assert_eq!(token_balance(&token, game.id().as_str()).await?, amount);
    assert_eq!(token_balance(&token, alice.id().as_str()).await?, 0);
    register_storage(&alice, &token, minimum).await?;
    let retry = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":1}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    trace(
        &worker,
        &retry,
        alice.id().as_str(),
        &game,
        &token,
        ("execute_operation", true, "on_unlock", None),
    )
    .await?;
    assert_eq!(locked(&game, &alice).await?, 0);
    assert_eq!(token_balance(&token, game.id().as_str()).await?, 0);
    assert_eq!(token_balance(&token, alice.id().as_str()).await?, amount);
    let duplicate = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":1}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("unlock cannot return the same lock twice");
    assert!(format!("{duplicate:?}").contains("E56"));
    reconcile(&game, &token, ALLOWANCE - amount, &[0, amount]).await?;
    println!(
        "Unknown token transport stays pending for authenticated same-id replay; native payments have no such recovery. Receipt gas above is sampled, not a worst-case bound."
    );
    Ok(())
}
