//! Real local game/token fault paths with a MOCK OutLayer; not testnet evidence.
//! Build sandbox artifacts first; run: cargo run -p sandbox-tests --profile fast --example effect-gas
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{Value, json};
use std::time::Duration;

const ALLOWANCE: u128 = (1u128 << 127) - 1;
const MINT: u128 = ALLOWANCE / 2;

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
                        "ACTION tx={tx} receipt={id} predecessor={} receiver={} method={} status={status} allocated_gas={} burnt_gas={}",
                        receipt["predecessor_id"],
                        receipt["receiver_id"],
                        call["method_name"],
                        call["gas"],
                        outcome["outcome"]["gas_burnt"]
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

// Match the detached transfer and callback in the originating transaction graph.
async fn payment_trace(
    worker: &Worker<Sandbox>,
    result: &ExecutionFinalResult,
    sender: &str,
    game: &Contract,
    payment: (&str, u128),
    callback: &str,
    expected_success: bool,
) -> Res<()> {
    let (receiver, amount) = payment;
    let tx = result.outcome().transaction_hash.to_string();
    for _ in 0..100 {
        let status = rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({
                "tx_hash":tx,"sender_account_id":sender,"wait_until":"INCLUDED"
            }),
        )?;
        let (mut transfer, mut completed) = (false, false);
        if let Some(outcomes) = status["receipts_outcome"].as_array() {
            for outcome in outcomes {
                let id = outcome["id"].as_str().ok_or("missing receipt id")?;
                let receipt = rpc(worker, "EXPERIMENTAL_receipt", json!({"receipt_id":id}))?;
                if receipt["receipt_id"] != id
                    || receipt["receiver_id"] != outcome["outcome"]["executor_id"]
                {
                    return Err(format!("receipt identity mismatch: {id}").into());
                }
                let Some(actions) = receipt["receipt"]["Action"]["actions"].as_array() else {
                    continue;
                };
                let result = &outcome["outcome"]["status"];
                let success = result.get("SuccessValue").is_some()
                    || result.get("SuccessReceiptId").is_some();
                for action in actions {
                    if receipt["predecessor_id"] == game.id().as_str()
                        && receipt["receiver_id"] == receiver
                        && action["Transfer"]["deposit"] == amount.to_string()
                    {
                        if success != expected_success
                            || (!success && result.get("Failure").is_none())
                        {
                            return Err(format!("unexpected transfer {id}: {result}").into());
                        }
                        transfer = true;
                        println!(
                            "TRANSFER tx={tx} receipt={id} predecessor={} receiver={receiver} amount={amount} status={result} burnt_gas={}",
                            receipt["predecessor_id"], outcome["outcome"]["gas_burnt"]
                        );
                    }
                    let call = &action["FunctionCall"];
                    if receipt["predecessor_id"] == game.id().as_str()
                        && receipt["receiver_id"] == game.id().as_str()
                        && call["method_name"] == callback
                    {
                        if !success || call["gas"].as_u64() != Some(10_000_000_000_000) {
                            return Err(format!(
                                "unexpected callback {id}: {result} gas={}",
                                call["gas"]
                            )
                            .into());
                        }
                        completed = true;
                        println!(
                            "CALLBACK tx={tx} receipt={id} predecessor={} receiver={} method={callback} status={result} allocated_gas={} burnt_gas={}",
                            receipt["predecessor_id"],
                            receipt["receiver_id"],
                            call["gas"],
                            outcome["outcome"]["gas_burnt"]
                        );
                    }
                }
            }
        }
        if transfer && completed {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("tx {tx}: missing transfer or {callback}").into())
}

async fn platform_accrued(game: &Contract) -> Res<u128> {
    let ledger: Value = game.view("get_ledger").await?.json()?;
    Ok(ledger["platform_accrued"]
        .as_str()
        .ok_or("missing platform accrued")?
        .parse()?)
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
async fn locked(game: &Contract, alice: &Account, round_id: u32) -> Res<u128> {
    let amount: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":round_id,"account":alice.id()}))
        .await?
        .json()?;
    Ok(amount.parse()?)
}
async fn reconcile(
    game: &Contract,
    token: &Contract,
    round_id: u32,
    expected_allowance: u128,
    expected: &[u128],
) -> Res<()> {
    let round: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":round_id}))
        .await?
        .json()?;
    assert_eq!(round["allowance_left"], expected_allowance.to_string());
    let rows: Vec<Value> = game
        .view("get_log")
        .args_json(json!({"mode":0,"id":round_id,"from_idx":0,"limit":200}))
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
async fn wait_until(worker: &Worker<Sandbox>, deadline: u64) -> Res<()> {
    let stop = std::time::Instant::now() + Duration::from_secs(120);
    while worker.view_block().await?.timestamp() < deadline {
        if std::time::Instant::now() >= stop {
            return Err("sandbox deadline not reached".into());
        }
        worker.fast_forward(5).await?;
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
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
        .args_json(json!({"minter":game.id(),"cap":u128::MAX.to_string(),
        "metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}}))
        .transact()
        .await?
        .into_result()?;
    fund_token_operations(&token).await?;
    let mut config =
        sandbox_tests::params(mock.id().as_str(), worker.view_block().await?.timestamp());
    config["token"] = json!(token.id());
    let root = worker.root_account()?;
    let platform_id = format!("effect-platform.{}", root.id());
    config["platform"] = json!(platform_id);
    config["base_attempts"] = json!([3, 50]);
    config["round_allowance"] = json!(ALLOWANCE.to_string());
    config["mint_base"] = json!(MINT.to_string());
    config["round_period_ns"] = json!(30_000_000_000u64);
    config["reveal_window_ns"] = json!(1_000_000_000u64);
    let url = format!("https://example.com/{}", "x".repeat(2028));
    assert_eq!(url.len(), 2048);
    config["referee"]["urls"] = json!([url, url]);
    config["lock_tiers"] = json!([
        {"amount":"1","extra_attempts":1},
        {"amount":"2","extra_attempts":2},
        {"amount":"3","extra_attempts":3}
    ]);
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
            .args_json(json!({"mode":0,"id":null}))
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
    // Freeze nine independent Teams early using real correct-guess callbacks;
    // the long Solo investigation remains live for the effect receipts.
    let solo: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":null}))
        .await?
        .json()?;
    let solo_id = solo["round_id"].as_u64().ok_or("missing Solo round")? as u32;
    let (rule, _) = rule_core::sample(b"effect-gas-team");
    let mut previous = None;
    for index in 0..9u32 {
        let captain = worker.dev_create_account().await?;
        captain
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let team_id: u32 = captain
            .call(game.id(), "create_team")
            .args_json(json!({"name":format!("team{index}")}))
            .max_gas()
            .transact()
            .await?
            .json()?;
        captain
            .call(game.id(), "team_deposit")
            .args_json(json!({"team_id":team_id}))
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let slot: Value = game
            .view("get_next_slot")
            .args_json(json!({"mode":1}))
            .await?
            .json()?;
        let round_id = slot["round_id"].as_u64().ok_or("missing Team slot")? as u32;
        wait_until(
            &worker,
            slot["slot_ns"].as_u64().ok_or("missing Team slot time")?,
        )
        .await?;
        if let Some(last) = previous {
            assert!(round_id > last);
        }
        previous = Some(round_id);
        let begin_id = 1 + 3 * index;
        let begin = game
            .call("start_round")
            .args_json(json!({"mode":1,"round_id":round_id}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, begin_id + 1).await?;
        resolve(&mock, begin_id, begin_value(&"11".repeat(32)), false).await?;
        begin.await?.into_result()?;
        let mut observed = false;
        for _ in 0..50 {
            let r: Value = game
                .view("get_round")
                .args_json(json!({"mode":1,"id":round_id}))
                .await?
                .json()?;
            if r["phase"] == "Investigation" {
                observed = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        assert!(observed);
        let hash = protocol::commit_hash(&protocol::CommitPreimage {
            chain: "testnet",
            game: game.id().as_str(),
            mode: protocol::Mode::Team,
            round: round_id,
            actor: captain.id().as_str(),
            entity: protocol::Entity::Team(team_id),
            guess: &rule,
            salt: &[9; 32],
        });
        captain
            .call(game.id(), "commit_guess")
            .args_json(json!({"mode":1,"hash":hash}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        worker.fast_forward(5).await?;
        let reveal = captain.call(game.id(), "reveal_guess").args_json(json!({"mode":1,"commit_seq":0,"guess":serde_json::to_value(protocol::RuleHex(rule.clone()))?,"salt":"09".repeat(32)})).gas(Gas::from_tgas(300)).transact_async().await?;
        wait_requests(&mock, begin_id + 2).await?;
        resolve(&mock, begin_id + 1, json!({"correct":true}), false).await?;
        reveal.await?.into_result()?;
        let mut deadline = None;
        for _ in 0..50 {
            let r: Value = game
                .view("get_round")
                .args_json(json!({"mode":1,"id":round_id}))
                .await?
                .json()?;
            if r["phase"] == "Reveal" {
                deadline = r["reveal_deadline_ns"].as_u64();
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let deadline = deadline.ok_or("Team reveal not observed")?;
        let stop = std::time::Instant::now() + Duration::from_secs(120);
        while worker.view_block().await?.timestamp() < deadline {
            if std::time::Instant::now() >= stop {
                return Err("Team reveal deadline not reached".into());
            }
            worker.fast_forward(5).await?;
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let open = game
            .call("finalize")
            .args_json(json!({"mode":1,"round_id":round_id}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, begin_id + 3).await?;
        resolve(&mock, begin_id + 2, Value::Null, false).await?;
        open.await?.into_result()?;
        let mut observed = false;
        for _ in 0..50 {
            let r: Value = game
                .view("get_round")
                .args_json(json!({"mode":1,"id":round_id}))
                .await?
                .json()?;
            if r["phase"] == "Opening" && r["open_status"] == "failed" {
                observed = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        assert!(observed);
    }
    let active: Vec<Value> = game.view("get_active_rounds").await?.json()?;
    assert_eq!(active.len(), 10);
    let next: Value = game
        .view("get_next_slot")
        .args_json(json!({"mode":1}))
        .await?
        .json()?;
    wait_until(
        &worker,
        next["slot_ns"].as_u64().ok_or("missing capacity slot")?,
    )
    .await?;
    let capacity = game
        .call("start_round")
        .args_json(json!({"mode":1}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?
        .into_result()
        .expect_err("active root bound");
    assert!(format!("{capacity:?}").contains("E23"));
    println!(
        "MAX ROOT FIXTURE: two 2048-byte URLs, three lock tiers, ten actual nonterminal rounds"
    );
    let root = worker.root_account()?;
    let name = "x".repeat(64 - root.id().as_str().len() - 1);
    let alice = root
        .create_subaccount(&name)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(alice.id().as_str().len(), 64);
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
    for (id, number, success) in [(28, 2, false), (29, 3, true)] {
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
            reconcile(&game, &token, solo_id, ALLOWANCE - MINT, &[0, MINT]).await?;
            assert_eq!(token_balance(&token, alice.id().as_str()).await?, MINT);
        } else {
            reconcile(&game, &token, solo_id, ALLOWANCE, &[0]).await?;
            assert_eq!(token_balance(&token, alice.id().as_str()).await?, 0);
        }
    }

    // Move all minted tokens into a future lock; now the owner can unregister without burning.
    let amount = MINT;
    let slot: Value = game
        .view("get_next_slot")
        .args_json(json!({"mode":0}))
        .await?
        .json()?;
    let lock_id = slot["round_id"].as_u64().ok_or("missing lock slot")? as u32;
    let unlock_at = slot["slot_ns"].as_u64().ok_or("missing lock time")? + 30_000_000_000;
    alice
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":game.id(),"amount":amount.to_string(),
        "msg":json!({"lock":{"mode":0,"round_id":lock_id}}).to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(locked(&game, &alice, lock_id).await?, amount);
    assert_eq!(token_balance(&token, alice.id().as_str()).await?, 0);
    assert_eq!(token_balance(&token, game.id().as_str()).await?, amount);
    unregister(&alice, &token).await?;
    wait_until(&worker, unlock_at).await?;
    let first = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":lock_id}))
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
    assert_eq!(locked(&game, &alice, lock_id).await?, amount);
    assert_eq!(token_balance(&token, game.id().as_str()).await?, amount);
    assert_eq!(token_balance(&token, alice.id().as_str()).await?, 0);
    register_storage(&alice, &token, minimum).await?;
    let retry = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":lock_id}))
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
    assert_eq!(locked(&game, &alice, lock_id).await?, 0);
    assert_eq!(token_balance(&token, game.id().as_str()).await?, 0);
    assert_eq!(token_balance(&token, alice.id().as_str()).await?, amount);
    let duplicate = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":lock_id}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("unlock cannot return the same lock twice");
    assert!(format!("{duplicate:?}").contains("E56"));
    reconcile(&game, &token, solo_id, ALLOWANCE - amount, &[0, amount]).await?;
    // A 64-character withdrawing account and real transfer/callback receipt pair.
    let before = credit(&game, &alice).await?;
    let withdrawn = before / 2;
    let result = alice
        .call(game.id(), "withdraw_credit")
        .args_json(json!({"amount":withdrawn.to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    payment_trace(
        &worker,
        &result,
        alice.id().as_str(),
        &game,
        (alice.id().as_str(), withdrawn),
        "on_withdraw",
        true,
    )
    .await?;
    assert_eq!(credit(&game, &alice).await?, before - withdrawn);

    // A missing configured platform fails, then the identical principal is paid after
    // creating that sandbox account. No callback or historical outcome is impersonated.
    let accrued = platform_accrued(&game).await?;
    assert!(accrued > 0);
    let result = alice
        .call(game.id(), "claim_platform")
        .max_gas()
        .transact()
        .await?;
    payment_trace(
        &worker,
        &result,
        alice.id().as_str(),
        &game,
        (&platform_id, accrued),
        "on_platform",
        false,
    )
    .await?;
    assert_eq!(platform_accrued(&game).await?, accrued);
    let platform = root
        .create_subaccount("effect-platform")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(platform.id().as_str(), platform_id);
    let result = alice
        .call(game.id(), "claim_platform")
        .max_gas()
        .transact()
        .await?;
    payment_trace(
        &worker,
        &result,
        alice.id().as_str(),
        &game,
        (&platform_id, accrued),
        "on_platform",
        true,
    )
    .await?;
    assert_eq!(platform_accrued(&game).await?, 0);
    println!(
        "Unknown token transport stays pending for authenticated same-id replay; native payments have no such recovery. Receipt gas above is sampled, not a worst-case bound."
    );
    Ok(())
}
