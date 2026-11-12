//! Wallet-signed browser fixture: isolated sandbox with mock OutLayer, not testnet evidence.
#[path = "../tests/common/mod.rs"]
mod common;

use common::{Res, mask_callback_exports, resolve, wait_requests};
use near_workspaces::types::{Gas, NearToken};
use protocol::{Hex32, RefereeRequest};
use rule_core::{Atom, CanonicalRule, Form, Literal};
use sandbox_tests::{artifact, params};
use serde_json::{Value, json};
use std::io::{BufRead, Write};

fn target(command: &Value) -> Res<(u8, u32)> {
    let mode = command.get("mode").map_or(Ok(0), |v| {
        v.as_u64().filter(|m| *m <= 1).ok_or("invalid mode")
    })?;
    // `id` belongs to the control channel's correlation protocol.
    let id = command.get("roundId").map_or(Ok(0), |v| {
        v.as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or("invalid roundId")
    })?;
    Ok((mode as u8, id))
}

async fn wait_timestamp(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    deadline: u64,
    input_open: &std::sync::atomic::AtomicBool,
) -> Res<()> {
    let stop = std::time::Instant::now() + std::time::Duration::from_secs(240);
    loop {
        let now = worker.view_block().await?.timestamp();
        if now >= deadline {
            break;
        }
        if !input_open.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("control channel closed while waiting for the clock".into());
        }
        if std::time::Instant::now() >= stop {
            return Err("sandbox timestamp deadline was not observed".into());
        }
        // About one second of chain time per block: step toward the target without overshooting far.
        let blocks = ((deadline - now) / 1_000_000_000).clamp(5, 1000);
        worker.fast_forward(blocks).await?;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Res<()> {
    let config_path = std::env::args()
        .nth(1)
        .ok_or("configuration path required")?;
    eprintln!("Sandbox with mock OutLayer, not testnet evidence: booting local node");
    let worker = near_workspaces::sandbox().await?;
    eprintln!("Deploying local mock/game/token");
    let mock = worker
        .dev_deploy(&std::fs::read(artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let wasm = std::fs::read(artifact("game"))?;
    let game = worker.dev_deploy(&wasm).await?;
    let token = worker
        .dev_deploy(&std::fs::read(artifact("token"))?)
        .await?;
    token
        .call("new")
        .args_json(json!({
            "minter":game.id(), "cap":"1000000000000000000000000000",
            "metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}
        }))
        .transact()
        .await?
        .into_result()?;
    common::fund_token_operations(&token).await?;
    // Deployment prerequisite: the game receives locked RULE. Players still register in the browser.
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let storage: u128 = bounds["min"]
        .as_str()
        .ok_or("storage minimum missing")?
        .parse()?;
    token
        .call("storage_deposit")
        .args_json(json!({"account_id":game.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(storage))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    eprintln!("Initializing game and funded fixture accounts");
    let mut config = params(mock.id().as_str(), worker.view_block().await?.timestamp());
    config["token"] = json!(token.id());
    config["base_attempts"] = json!([25, 50]);
    config["reveal_window_ns"] = json!(3_000_000_000u64);
    match std::env::args().nth(2).as_deref() {
        None => {}
        Some("transitions") => {
            // Only new local transition runs use compressed immutable timing.
            // Keep the original journey's defaults and production contracts unchanged.
            config["round_period_ns"] = json!(180_000_000_000u64);
            config["investigation_max_ns"] = json!(180_000_000_000u64);
        }
        Some(_) => return Err("unknown local fixture profile".into()),
    }
    // Browser regression tier only: earn real RULE before locking, without a premint.
    config["lock_tiers"] = json!([{"amount":"1000000000000000000","extra_attempts":25}]);
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    game.call("seed_pot")
        .args_json(json!({"mode":0}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    // No premint and no player credit: browser actions must fund and earn their own balances.
    let rule = CanonicalRule::new(
        Form::Single,
        vec![Literal {
            atom: Atom::new(0).ok_or("missing atom")?,
            negated: false,
        }],
    )
    .map_err(|e| format!("rule: {e:?}"))?;
    let salt = Hex32([5; 32]);
    let commitment = protocol::round_commitment(&rule, &[5; 32]);
    let begin_value = json!({"commit":commitment,"header":{
        "tier":"daily","bucket":"mid","grammar":Hex32(protocol::grammar_hash())
    }});
    let fixture = json!({
        "label":"sandbox with mock OutLayer, not testnet evidence",
        "rpcUrl":worker.rpc_addr(), "networkId":"sandbox", "chainId":"testnet",
        "game":game.id(), "token":token.id(), "mock":mock.id(),
        "accounts":[
            {"accountId":alice.id(),"secretKey":alice.secret_key().to_string()},
            {"accountId":bob.id(),"secretKey":bob.secret_key().to_string()}
        ]
    });
    std::fs::write(&config_path, serde_json::to_vec_pretty(&fixture)?)?;
    println!("WEB_E2E_READY");
    std::io::stdout().flush()?;
    // Stdin is the private control channel. EOF tears down the Worker and its node/home.
    let (tx, rx) = std::sync::mpsc::channel();
    let input_open = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let reader_open = input_open.clone();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
        reader_open.store(false, std::sync::atomic::Ordering::Relaxed);
    });
    let mut next_request = 0u32;
    loop {
        let line = match rx.try_recv() {
            Ok(line) => line?,
            Err(std::sync::mpsc::TryRecvError::Empty) => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
        };
        let command: Value = serde_json::from_str(&line)?;
        let result: Res<Value> = async {
            match command["op"].as_str().ok_or("operation missing")? {
                "sameMinuteWindow" => {
                    // Preserve the real clock: start the duplicate pair with at least 30 s left.
                    let second = (worker.view_block().await?.timestamp() / 1_000_000_000) % 60;
                    if second > 30 {
                        tokio::time::sleep(std::time::Duration::from_secs(61 - second)).await;
                    }
                    Ok(json!(true))
                }
                "advance" => {
                    worker
                        .fast_forward(command["blocks"].as_u64().unwrap_or(5))
                        .await?;
                    Ok(json!(true))
                }
                "enterNextSlot" => {
                    let (mode, _) = target(&command)?;
                    let slot: Value = game
                        .view("get_next_slot")
                        .args_json(json!({"mode":mode}))
                        .await?
                        .json()?;
                    let deadline = slot["slot_ns"]
                        .as_u64()
                        .ok_or("missing next slot timestamp")?;
                    wait_timestamp(&worker, deadline, &input_open).await?;
                    Ok(json!(true))
                }
                "startSolo" | "startTeam" => {
                    let mode = u8::from(command["op"] == "startTeam");
                    let begin = game
                        .call("start_round")
                        .args_json(json!({"mode":mode}))
                        .gas(Gas::from_tgas(300))
                        .transact_async()
                        .await?;
                    wait_requests(&mock, next_request + 1).await?;
                    resolve(&mock, next_request, begin_value.clone(), false).await?;
                    next_request += 1;
                    begin.await?.into_result()?;
                    Ok(json!(true))
                }
                "resolve" => {
                    wait_requests(&mock, next_request + 1).await?;
                    let request: Value = mock
                        .view("get_request")
                        .args_json(json!({"id":next_request}))
                        .await?
                        .json()?;
                    let input: RefereeRequest =
                        serde_json::from_str(request[1].as_str().ok_or("no request input")?)?;
                    let value = match input {
                        RefereeRequest::Verdict { play, .. } => {
                            json!({"v":u8::from(rule_core::eval(&rule,&play))})
                        }
                        RefereeRequest::Guess { guess, .. } => {
                            json!({"correct":rule_core::equivalent(&rule,&guess.0)})
                        }
                        RefereeRequest::Open { .. } => json!({"rule":rule,"salt":salt}),
                        _ => return Err("unexpected begin request".into()),
                    };
                    resolve(&mock, next_request, value.clone(), command["fail"] == true).await?;
                    next_request += 1;
                    Ok(value)
                }
                "enterReveal" => {
                    let (mode, id) = target(&command)?;
                    let round: Value = game
                        .view("get_round")
                        .args_json(json!({"mode":mode,"id":id}))
                        .await?
                        .json()?;
                    if round["phase"] == "Investigation" {
                        let deadline = round["investigation_end_ns"]
                            .as_u64()
                            .ok_or("missing investigation deadline")?;
                        wait_timestamp(&worker, deadline, &input_open).await?;
                        game.call("advance")
                            .args_json(json!({"mode":mode,"round_id":id}))
                            .max_gas()
                            .transact()
                            .await?
                            .into_result()?;
                    }
                    let after: Value = game
                        .view("get_round")
                        .args_json(json!({"mode":mode,"id":id}))
                        .await?
                        .json()?;
                    if after["phase"] != "Reveal" {
                        return Err("target did not enter Reveal".into());
                    }
                    Ok(json!(true))
                }
                "callbackFault" => {
                    // Genuine failed receipts, not held callbacks or production recovery.
                    let names: &[&str] = match command["kind"].as_str() {
                        Some("native") => &["on_withdraw"],
                        Some("token") => &["on_mint", "on_unlock"],
                        Some("registration") => &["on_register"],
                        Some("none") => &[],
                        _ => return Err("invalid callback fault kind".into()),
                    };
                    let code = mask_callback_exports(&wasm, names)?;
                    game.as_account().deploy(&code).await?.into_result()?;
                    Ok(json!(true))
                }
                "settle" => {
                    let (mode, id) = target(&command)?;
                    // The compressed reveal window must elapse in wall time as well as block height.
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                    worker.fast_forward(5).await?;
                    let finalize = game
                        .call("finalize")
                        .args_json(json!({"mode":mode,"round_id":id}))
                        .gas(Gas::from_tgas(300))
                        .transact_async()
                        .await?;
                    wait_requests(&mock, next_request + 1).await?;
                    resolve(&mock, next_request, json!({"rule":rule,"salt":salt}), false).await?;
                    next_request += 1;
                    finalize.await?.into_result()?;
                    for _ in 0..50 {
                        let round: Value = game
                            .view("get_round")
                            .args_json(json!({"mode":mode,"id":id}))
                            .await?
                            .json()?;
                        if round["phase"] == "Settled" {
                            return Ok(json!(true));
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }
                    Err("target settlement was not observed".into())
                }
                "indexSeason" => {
                    let (mode, _) = target(&command)?;
                    let season = command.get("season").map_or(Ok(0), |v| {
                        v.as_u64()
                            .and_then(|n| u32::try_from(n).ok())
                            .ok_or("invalid season")
                    })?;
                    game.call("index_season")
                        .args_json(json!({"mode":mode,"season":season,"limit":20}))
                        .max_gas()
                        .transact()
                        .await?
                        .into_result()?;
                    Ok(json!(true))
                }
                _ => Err("unknown harness operation".into()),
            }
        }
        .await;
        let response = match result {
            Ok(value) => json!({"id":command["id"],"result":value}),
            Err(error) => json!({"id":command["id"],"error":error.to_string()}),
        };
        println!("WEB_E2E_RESPONSE {response}");
        std::io::stdout().flush()?;
    }
    std::fs::remove_file(config_path)?;
    Ok(())
}
