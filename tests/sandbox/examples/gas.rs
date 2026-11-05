//! Request-side gas report using MOCK OutLayer, never testnet evidence.
//! Run with `cargo run -p sandbox-tests --profile fast --example gas`.
//! Yield callbacks finish later and are NOT measured by these transaction results.
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use protocol::RuleHex;
use serde_json::{Value, json};

const TGAS: u64 = 1_000_000_000_000;

/// Report successful transaction receipts, without counting asynchronous yield callbacks.
fn receipts(label: &str, result: ExecutionFinalResult) -> Res<()> {
    print!("GAS {label}: total ");
    tgas(result.total_gas_burnt.as_gas());
    print!(" Tgas; receipts [");
    for outcome in result.receipt_outcomes() {
        print!("{}:", outcome.executor_id);
        tgas(outcome.gas_burnt.as_gas());
        print!(" ");
    }
    println!("]");
    result.into_result()?;
    Ok(())
}

fn tgas(gas: u64) {
    print!("{}.{:01}", gas / TGAS, gas % TGAS / (TGAS / 10));
}

#[tokio::main]
async fn main() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let (rule, _) = rule_core::sample(b"sandbox-gas");
    let commit = serde_json::to_value(protocol::round_commitment(&rule, &[5u8; 32]))?;
    let Env { mock, game, token } = start(&worker, commit.as_str().unwrap(), 3_000_000_000).await?;
    let alice = worker.dev_create_account().await?;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    // NEP-145 storage is paid directly; the game only checks registration, never charges it.
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let deposit = bounds["min"]
        .as_str()
        .ok_or("missing token storage minimum")?
        .parse()?;
    for account in [alice.id(), game.id()] {
        alice
            .call(token.id(), "storage_deposit")
            .args_json(json!({"account_id":account,"registration_only":true}))
            .deposit(NearToken::from_yoctonear(deposit))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let register = alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?;
    receipts("register_token", register)?;

    // Request side of a play whose verdict will mint.
    let play = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":2,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    resolve(&mock, 1, json!({"v":1}), false).await?;
    let play = play.await?;
    receipts("play (request side)", play)?;

    let mut received_mint = false;
    for _ in 0..50 {
        let balance: String = token
            .view("ft_balance_of")
            .args_json(json!({"account_id":alice.id()}))
            .await?
            .json()?;
        if balance.parse::<u128>()? > 0 {
            received_mint = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert!(received_mint, "ACCEPT never credited RULE");
    let lock = alice.call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":game.id(),"amount":"1","msg":json!({"lock":{"mode":0,"round_id":1}}).to_string()}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    receipts("lock (NEP-141)", lock)?;
    let locked: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":1,"account":alice.id()}))
        .await?
        .json()?;
    assert_eq!(locked, "1");
    // This demo's genesis is zero: the never-started next round's unlock period has elapsed.
    let unlock = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":1}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    receipts("unlock", unlock)?;
    let locked: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":1,"account":alice.id()}))
        .await?
        .json()?;
    assert_eq!(locked, "0");

    let salt = [9u8; 32];
    let hash = commit_hash(&game, &alice, &rule, salt);
    let commit_tx = alice
        .call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":hash}))
        .max_gas()
        .transact()
        .await?;
    receipts("commit_guess", commit_tx)?;
    worker.fast_forward(5).await?;
    let reveal = alice
        .call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":0,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":"09".repeat(32)}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 3).await?;
    resolve(&mock, 2, json!({"correct":true}), false).await?;
    let reveal = reveal.await?;
    receipts("reveal_guess (request side)", reveal)?;
    wait_status(&game, 0, "Correct").await?;

    let mut finalize: Option<ExecutionFinalResult> = None;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        worker.fast_forward(2).await?;
        let attempt = alice
            .call(game.id(), "finalize")
            .args_json(json!({"mode":0}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?
            .await?;
        if attempt.is_success() {
            finalize = Some(attempt);
            break;
        }
    }
    receipts(
        "finalize (request side)",
        finalize.expect("finalize never completed"),
    )?;
    wait_requests(&mock, 4).await?;
    let opened = json!({"rule":serde_json::to_value(&rule)?,"salt":"05".repeat(32)});
    resolve(&mock, 3, opened, false).await?;
    let mut settled = false;
    for _ in 0..30 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":null}))
            .await?
            .json()?;
        if round["phase"] == "Settled" {
            settled = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    assert!(settled);
    let claim = alice
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?;
    receipts("claim", claim)?;
    Ok(())
}
