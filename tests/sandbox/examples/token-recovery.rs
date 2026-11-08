//! Actual local WASM recovery after completed token effects and failed game callbacks.
//! Export-only faults and key-retaining redeployment are sandbox instrumentation, not production recovery.
#[path = "../tests/common/mod.rs"]
mod common;
use base64::{Engine, engine::general_purpose::STANDARD};
use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker, network::Sandbox, result::ExecutionFinalResult};
use protocol::token::{TokenOperation, TokenOperationStatus, TokenOutcome};
use serde_json::{Value, json};
use std::time::Duration;

fn mask_callbacks(wasm: &[u8]) -> Res<Vec<u8>> {
    let mut offsets = Vec::new();
    for payload in wasmparser::Parser::new(0).parse_all(wasm) {
        if let wasmparser::Payload::ExportSection(section) = payload? {
            for export in section {
                let export = export?;
                if ["on_mint", "on_unlock"].contains(&export.name) {
                    let start = export.name.as_ptr() as usize - wasm.as_ptr() as usize;
                    offsets.push((start, export.name.len()));
                }
            }
        }
    }
    assert_eq!(
        offsets.len(),
        2,
        "fault fixture must mask exactly two exports"
    );
    let mut fault = wasm.to_vec();
    for (start, len) in offsets {
        fault[start..start + len].fill(b'x');
    }
    wasmparser::Validator::new().validate_all(&fault)?;
    Ok(fault)
}

fn rpc(worker: &Worker<Sandbox>, method: &str, params: Value) -> Res<Value> {
    let body = json!({"jsonrpc":"2.0","id":"token-recovery","method":method,"params":params});
    let output = std::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--fail-with-body",
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
        return Err(format!(
            "{method}: {} {}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        )
        .into());
    }
    let value: Value = serde_json::from_slice(&output.stdout)?;
    if let Some(error) = value.get("error") {
        return Err(format!("{method}: {error}").into());
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| format!("{method}: missing result").into())
}

async fn observe_operation(
    worker: &Worker<Sandbox>,
    result: &ExecutionFinalResult,
    sender: &str,
    game: &Contract,
    token: &Contract,
    expected: (&str, bool, Option<TokenOperationStatus>, usize),
) -> Res<TokenOperation> {
    let (callback, callback_success, expected, copies) = expected;
    let tx = result.outcome().transaction_hash.to_string();
    for _ in 0..100 {
        let status = rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({"tx_hash":tx,"sender_account_id":sender,"wait_until":"INCLUDED"}),
        )?;
        let mut operation = None;
        let mut completed = 0;
        let mut executed = 0;
        if let Some(outcomes) = status["receipts_outcome"].as_array() {
            for outcome in outcomes {
                let id = outcome["id"].as_str().ok_or("missing receipt id")?;
                let receipt = rpc(worker, "EXPERIMENTAL_receipt", json!({"receipt_id":id}))?;
                assert_eq!(receipt["receipt_id"], id);
                assert_eq!(receipt["receiver_id"], outcome["outcome"]["executor_id"]);
                let Some(actions) = receipt["receipt"]["Action"]["actions"].as_array() else {
                    continue;
                };
                for action in actions {
                    let call = &action["FunctionCall"];
                    let external = call["method_name"] == "execute_operation"
                        && receipt["predecessor_id"] == game.id().as_str()
                        && receipt["receiver_id"] == token.id().as_str();
                    let is_callback = call["method_name"] == callback
                        && receipt["predecessor_id"] == game.id().as_str()
                        && receipt["receiver_id"] == game.id().as_str();
                    if !external && !is_callback {
                        continue;
                    }
                    let receipt_status = &outcome["outcome"]["status"];
                    let success = receipt_status.get("SuccessValue").is_some();
                    if external {
                        executed += 1;
                        let args: Value = serde_json::from_slice(
                            &STANDARD.decode(call["args"].as_str().ok_or("missing args")?)?,
                        )?;
                        operation = Some(serde_json::from_value::<TokenOperation>(
                            args["operation"].clone(),
                        )?);
                        if let Some(expected) = expected {
                            assert!(
                                success,
                                "token outcome receipt must succeed: {receipt_status}"
                            );
                            let ack: TokenOutcome = serde_json::from_slice(
                                &STANDARD.decode(
                                    receipt_status["SuccessValue"]
                                        .as_str()
                                        .ok_or("missing outcome")?,
                                )?,
                            )?;
                            assert_eq!(ack.operation, *operation.as_ref().unwrap());
                            assert_eq!(ack.status, expected);
                        } else {
                            assert!(!success);
                            assert!(receipt_status.to_string().contains("E24"));
                        }
                    } else {
                        assert_eq!(success, callback_success, "{callback}: {receipt_status}");
                        if !callback_success {
                            assert!(
                                receipt_status.to_string().contains("MethodNotFound"),
                                "fault was not export resolution: {receipt_status}"
                            );
                        }
                        completed += 1;
                    }
                    println!(
                        "RECOVERY RECEIPT tx={tx} receipt={id} method={} status={receipt_status} allocated={} burnt={}",
                        call["method_name"], call["gas"], outcome["outcome"]["gas_burnt"]
                    );
                }
            }
        }
        if completed == copies
            && executed == copies
            && let Some(operation) = operation
        {
            return Ok(operation);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("missing completed token/callback receipts for {tx}").into())
}

async fn pending(game: &Contract, id: u64) -> Res<Option<TokenOperation>> {
    Ok(game
        .view("get_token_operation")
        .args_json(json!({"request_id":id}))
        .await?
        .json()?)
}
async fn balance(token: &Contract, account: &str) -> Res<u128> {
    let value: String = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":account}))
        .await?
        .json()?;
    Ok(value.parse()?)
}
async fn supply(token: &Contract) -> Res<u128> {
    let value: String = token.view("ft_total_supply").await?.json()?;
    Ok(value.parse()?)
}
async fn funding(token: &Contract) -> Res<Value> {
    Ok(token.view("get_operation_funding").await?.json()?)
}
async fn register(who: &Account, token: &Contract, account: &str, minimum: u128) -> Res<()> {
    who.call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":account,"registration_only":true}))
        .deposit(NearToken::from_yoctonear(minimum))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}
async fn play(
    worker: &Worker<Sandbox>,
    env: &Env,
    who: &Account,
    mock_id: u32,
    number: u16,
    callback_success: bool,
    expected: Option<TokenOperationStatus>,
) -> Res<TokenOperation> {
    let tx = who
        .call(env.game.id(), "play")
        .args_json(json!({"mode":0,"number":number,"word":"otter"}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&env.mock, mock_id + 1).await?;
    resolve(&env.mock, mock_id, json!({"v":1}), false).await?;
    let result = tx.await?;
    assert!(result.is_success(), "{result:?}");
    observe_operation(
        worker,
        &result,
        who.id().as_str(),
        &env.game,
        &env.token,
        ("on_mint", callback_success, expected, 1),
    )
    .await
}
async fn replay_pair(
    worker: &Worker<Sandbox>,
    env: &Env,
    who: &Account,
    op: &TokenOperation,
    callback: &str,
    success: bool,
    status: TokenOperationStatus,
) -> Res<()> {
    // Both calls enter one action receipt, so both replays are scheduled before
    // either completion callback can consume the pending request.
    let call = || {
        near_workspaces::operations::Function::new("retry_token_operation")
            .args_json(json!({"request_id":op.operation_id}))
            .gas(Gas::from_tgas(150))
    };
    let result = who
        .batch(env.game.id())
        .call(call())
        .call(call())
        .transact()
        .await?;
    assert!(result.is_success());
    let observed = observe_operation(
        worker,
        &result,
        who.id().as_str(),
        &env.game,
        &env.token,
        (callback, success, Some(status), 2),
    )
    .await?;
    assert_eq!(observed, *op);
    Ok(())
}
async fn lock(env: &Env, who: &Account, amount: u128, round_id: u32) -> Res<u128> {
    let used: String = who.call(env.token.id(), "ft_transfer_call").args_json(json!({"receiver_id":env.game.id(),"amount":amount.to_string(),"msg":json!({"lock":{"mode":0,"round_id":round_id}}).to_string()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.json()?;
    Ok(used.parse()?)
}
async fn wait_until(worker: &Worker<Sandbox>, deadline: u64) -> Res<()> {
    let stop = std::time::Instant::now() + Duration::from_secs(900);
    while worker.view_block().await?.timestamp() < deadline {
        if std::time::Instant::now() >= stop {
            return Err("sandbox deadline not reached".into());
        }
        worker.fast_forward(1000).await?;
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Res<()> {
    println!(
        "LOCAL TOKEN RECOVERY: actual game/token WASM, MOCK OutLayer, export-only faults; no testnet"
    );
    let worker = near_workspaces::sandbox().await?;
    let wasm = std::fs::read(sandbox_tests::artifact("game"))?;
    let fault = mask_callbacks(&wasm)?;
    let mock = worker
        .dev_deploy(&std::fs::read(sandbox_tests::artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let game = worker.dev_deploy(&wasm).await?;
    let token = worker
        .dev_deploy(&std::fs::read(sandbox_tests::artifact("token"))?)
        .await?;
    token.call("new").args_json(json!({"minter":game.id(),"cap":"1000000000000000000000000000","metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}})).transact().await?.into_result()?;
    let mut config =
        sandbox_tests::params(mock.id().as_str(), worker.view_block().await?.timestamp());
    config["token"] = json!(token.id());
    config["base_attempts"] = json!([5, 50]);
    config["round_period_ns"] = json!(120_000_000_000u64);
    config["investigation_max_ns"] = json!(600_000_000_000u64);
    config["reveal_window_ns"] = json!(1_000_000_000u64);
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    let env = Env { mock, game, token };
    let begin = env
        .game
        .call("start_round")
        .args_json(json!({"mode":0}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&env.mock, 1).await?;
    resolve(&env.mock, 0, begin_value(&"11".repeat(32)), false).await?;
    begin.await?.into_result()?;
    let alice = worker.dev_create_account().await?;
    let helper = worker.dev_create_account().await?;
    alice
        .call(env.game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let bounds: Value = env.token.view("storage_balance_bounds").await?.json()?;
    let minimum: u128 = bounds["min"].as_str().unwrap().parse()?;
    register(&alice, &env.token, alice.id().as_str(), minimum).await?;
    register(&alice, &env.token, env.game.id().as_str(), minimum).await?;
    alice
        .call(env.game.id(), "register_token")
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    for _ in 0..50 {
        let state: String = env
            .game
            .view("get_token_state")
            .args_json(json!({"account":alice.id()}))
            .await?
            .json()?;
        if state == "registered" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    // Insufficient dedicated token storage is UNKNOWN, not a failed mint or spent allowance refund.
    let first = play(&worker, &env, &alice, 1, 2, true, None).await?;
    assert_eq!(
        pending(&env.game, first.operation_id).await?,
        Some(first.clone())
    );
    assert_eq!(supply(&env.token).await?, 0);
    let quote = funding(&env.token).await?;
    let cost: u128 = quote["cost_per_operation"].as_str().unwrap().parse()?;
    helper
        .call(env.token.id(), "fund_operations")
        .deposit(NearToken::from_yoctonear(cost * 8))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    replay_pair(
        &worker,
        &env,
        &helper,
        &first,
        "on_mint",
        true,
        TokenOperationStatus::Applied,
    )
    .await?;
    assert!(pending(&env.game, first.operation_id).await?.is_none());
    assert_eq!(supply(&env.token).await?, first.amount.0);
    assert_eq!(
        funding(&env.token).await?["available"],
        (cost * 7).to_string()
    );

    // Token commits an effect, but the game callback genuinely fails method resolution.
    env.game.as_account().deploy(&fault).await?.into_result()?;
    let second = play(
        &worker,
        &env,
        &alice,
        2,
        3,
        false,
        Some(TokenOperationStatus::Applied),
    )
    .await?;
    let issued = first.amount.0 + second.amount.0;
    assert_eq!(supply(&env.token).await?, issued);
    assert_eq!(
        pending(&env.game, second.operation_id).await?,
        Some(second.clone())
    );
    let before = funding(&env.token).await?;
    replay_pair(
        &worker,
        &env,
        &helper,
        &second,
        "on_mint",
        false,
        TokenOperationStatus::Applied,
    )
    .await?;
    assert_eq!(funding(&env.token).await?, before);
    assert_eq!(supply(&env.token).await?, issued);
    env.game.as_account().deploy(&wasm).await?.into_result()?;
    replay_pair(
        &worker,
        &env,
        &helper,
        &second,
        "on_mint",
        true,
        TokenOperationStatus::Applied,
    )
    .await?;
    assert!(pending(&env.game, second.operation_id).await?.is_none());
    assert_eq!(supply(&env.token).await?, issued);
    let slot: Value = env
        .game
        .view("get_next_slot")
        .args_json(json!({"mode":0}))
        .await?
        .json()?;
    let old_lock = slot["round_id"].as_u64().ok_or("missing lock slot")? as u32;
    let expiry = slot["slot_ns"].as_u64().ok_or("missing lock timestamp")? + 120_000_000_000;
    let release = issued / 2;
    assert_eq!(lock(&env, &alice, release, old_lock).await?, release);

    // A durable rejection stays rejected even after the receiver re-registers.
    // Reconcile it only after the old round is terminal and the next one is live.
    let bob = worker.dev_create_account().await?;
    bob.call(env.game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    register(&bob, &env.token, bob.id().as_str(), minimum).await?;
    bob.call(env.game.id(), "register_token")
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    for _ in 0..50 {
        let state: String = env
            .game
            .view("get_token_state")
            .args_json(json!({"account":bob.id()}))
            .await?
            .json()?;
        if state == "registered" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let removed: bool = bob
        .call(env.token.id(), "storage_unregister")
        .args_json(json!({"force":false}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert!(removed);
    let before_round: Value = env
        .game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    env.game.as_account().deploy(&fault).await?.into_result()?;
    let rejected = play(
        &worker,
        &env,
        &bob,
        3,
        4,
        false,
        Some(TokenOperationStatus::ReceiverUnregistered),
    )
    .await?;
    assert_eq!(
        pending(&env.game, rejected.operation_id).await?,
        Some(rejected.clone())
    );
    assert_eq!(supply(&env.token).await?, issued);
    register(&bob, &env.token, bob.id().as_str(), minimum).await?;
    // A successful unlock plus failed callback must never release a later paid replacement lock.
    wait_until(&worker, expiry).await?;
    env.game.as_account().deploy(&fault).await?.into_result()?;
    let unlock = alice
        .call(env.game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":old_lock}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    let op = observe_operation(
        &worker,
        &unlock,
        alice.id().as_str(),
        &env.game,
        &env.token,
        ("on_unlock", false, Some(TokenOperationStatus::Applied), 1),
    )
    .await?;
    assert_eq!(balance(&env.token, env.game.id().as_str()).await?, 0);
    assert_eq!(balance(&env.token, alice.id().as_str()).await?, issued);
    assert_eq!(
        lock(&env, &alice, 7, old_lock).await?,
        0,
        "expired lock was accepted"
    );
    let slot: Value = env
        .game
        .view("get_next_slot")
        .args_json(json!({"mode":0}))
        .await?
        .json()?;
    let replacement = slot["round_id"]
        .as_u64()
        .ok_or("missing replacement slot")? as u32;
    assert!(replacement > old_lock);
    assert_eq!(lock(&env, &alice, 7, replacement).await?, 7);
    env.game.as_account().deploy(&wasm).await?.into_result()?;
    let before = funding(&env.token).await?;
    replay_pair(
        &worker,
        &env,
        &helper,
        &op,
        "on_unlock",
        true,
        TokenOperationStatus::Applied,
    )
    .await?;
    assert_eq!(funding(&env.token).await?, before);
    assert_eq!(balance(&env.token, env.game.id().as_str()).await?, 7);
    let locked: String = env
        .game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":replacement,"account":alice.id()}))
        .await?
        .json()?;
    assert_eq!(locked, "7");
    let old_locked: String = env
        .game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":old_lock,"account":alice.id()}))
        .await?
        .json()?;
    assert_eq!(old_locked, "0");
    assert!(pending(&env.game, op.operation_id).await?.is_none());
    assert_eq!(supply(&env.token).await?, issued);
    let round: Value = env
        .game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    wait_until(
        &worker,
        round["investigation_end_ns"]
            .as_u64()
            .ok_or("missing investigation deadline")?,
    )
    .await?;
    helper
        .call(env.game.id(), "advance")
        .args_json(json!({"mode":0}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let round: Value = env
        .game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    wait_until(
        &worker,
        round["reveal_deadline_ns"]
            .as_u64()
            .ok_or("missing reveal deadline")?,
    )
    .await?;
    let finalization = helper
        .call(env.game.id(), "finalize")
        .args_json(json!({"mode":0}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&env.mock, 5).await?;
    let (rule, _) = rule_core::sample(b"token-recovery-void");
    resolve(
        &env.mock,
        4,
        json!({
            "rule":rule,
            "salt":"55".repeat(32)
        }),
        false,
    )
    .await?;
    finalization.await?.into_result()?;
    let mut terminal = false;
    for _ in 0..50 {
        let round: Value = env
            .game
            .view("get_round")
            .args_json(json!({"mode":0,"id":0}))
            .await?
            .json()?;
        if round["phase"] == "Void" {
            terminal = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(terminal, "hash-mismatched opening must reach Void");
    let begin = helper
        .call(env.game.id(), "start_round")
        .args_json(json!({"mode":0}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&env.mock, 6).await?;
    resolve(&env.mock, 5, begin_value(&"33".repeat(32)), false).await?;
    begin.await?.into_result()?;
    let mut next_live = false;
    for _ in 0..50 {
        let round: Value = env
            .game
            .view("get_round")
            .args_json(json!({"mode":0,"id":null}))
            .await?
            .json()?;
        if round["phase"] == "Investigation" {
            next_live = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(next_live);
    env.game.as_account().deploy(&wasm).await?.into_result()?;
    let before = funding(&env.token).await?;
    replay_pair(
        &worker,
        &env,
        &helper,
        &rejected,
        "on_mint",
        true,
        TokenOperationStatus::ReceiverUnregistered,
    )
    .await?;
    assert_eq!(funding(&env.token).await?, before);
    let old: Value = env
        .game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    assert_eq!(old["phase"], "Void");
    assert_eq!(old["allowance_left"], before_round["allowance_left"]);
    assert!(pending(&env.game, rejected.operation_id).await?.is_none());
    let rows: Vec<Value> = env
        .game
        .view("get_log")
        .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
        .await?
        .json()?;
    assert_eq!(rows[2]["minted"], "0");
    assert_eq!(rows[2]["verdict"], true);
    assert_eq!(supply(&env.token).await?, issued);
    assert_eq!(balance(&env.token, bob.id().as_str()).await?, 0);
    println!(
        "TOKEN RECOVERY PASS: empty-budget retry; completed mint/unlock with failed callbacks; overlapping permissionless replay; replacement-lock custody; immutable rejection after registration, Void and next-round start; exact supply/funding conservation"
    );
    Ok(())
}
