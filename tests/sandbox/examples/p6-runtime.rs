//! Lead-operated local WASM qualification; MOCK OutLayer, never testnet evidence.
//! From the repository root, after building the three sandbox artifacts:
//! `cargo run -p sandbox-tests --profile fast --example p6-runtime`
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const BYTE_COST: u128 = 10_000_000_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
type SandboxWorker = Worker<Sandbox>;

async fn fixture(worker: &SandboxWorker, investigation_seconds: u64) -> Res<Env> {
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
        .args_json(json!({
            "minter":game.id(),"cap":"1000000000000000000000000000",
            "metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}
        }))
        .transact()
        .await?
        .into_result()?;
    fund_token_operations(&token).await?;
    let mut config =
        sandbox_tests::params(mock.id().as_str(), worker.view_block().await?.timestamp());
    config["token"] = json!(token.id());
    config["investigation_max_ns"] = json!(investigation_seconds * SECOND);
    config["reveal_window_ns"] = json!(if investigation_seconds == 120 {
        5 * SECOND
    } else {
        300 * SECOND
    });
    config["storage_charge_account"] = json!((512 * BYTE_COST).to_string());
    config["storage_charge_per_play"] = json!((2048 * BYTE_COST).to_string());
    config["storage_charge_team"] = json!((2048 * BYTE_COST).to_string());
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(Env { mock, game, token })
}

async fn round(game: &Contract) -> Res<Value> {
    Ok(game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?)
}

async fn phase(game: &Contract, expected: &str) -> Res<Value> {
    for _ in 0..150 {
        let state = round(game).await?;
        if state["phase"] == expected {
            return Ok(state);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("round never reached {expected}").into())
}

async fn due(worker: &SandboxWorker, deadline: u64, max_seconds: u64) -> Res<()> {
    let stop = Instant::now() + Duration::from_secs(max_seconds);
    while worker.view_block().await?.timestamp() < deadline {
        if Instant::now() >= stop {
            return Err("sandbox clock did not reach deadline".into());
        }
        worker.fast_forward(5).await?;
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Ok(())
}

async fn start(game: &Contract, mock: &Contract, commitment: &str) -> Res<()> {
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":0,"round_id":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(mock, 1).await?;
    resolve(mock, 0, begin_value(commitment), false).await?;
    tokio::time::timeout(Duration::from_secs(30), begin)
        .await??
        .into_result()?;
    phase(game, "Investigation").await?;
    Ok(())
}

// Never forward credentials, URLs, or unbounded child output.
fn sanitized_output(bytes: &[u8], secrets: &[String]) -> String {
    let mut text = String::from_utf8_lossy(bytes).into_owned();
    for secret in secrets {
        if !secret.is_empty() {
            text = text.replace(secret, "[redacted]");
        }
    }
    text.split_whitespace()
        .map(|word| {
            if word.contains("http://") || word.contains("https://") {
                "[url]"
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(4000)
        .collect()
}

// Both the child and its Wrangler descendants are terminated on timeout in WSL.
async fn keeper(
    worker: &SandboxWorker,
    game: &Contract,
    signer: &Account,
    racer: &Account,
    kind: &str,
) -> Res<()> {
    let node = std::env::var_os("P6_NODE").unwrap_or_else(|| "node".into());
    let secrets = [
        signer.secret_key().to_string(),
        racer.secret_key().to_string(),
    ];
    let mut command = Command::new(node);
    command
        .args([
            "--experimental-strip-types",
            "apps/keeper/ci/sandbox-smoke.ts",
        ])
        .env("NEAR_RPC_URL", worker.rpc_addr())
        .env("GAME_ACCOUNT", game.id().as_str())
        .env("KEEPER_ACCOUNT", signer.id().as_str())
        .env("KEEPER_PRIVATE_KEY", &secrets[0])
        .env("RACER_ACCOUNT", racer.id().as_str())
        .env("RACER_PRIVATE_KEY", &secrets[1])
        .env("KEEPER_SMOKE_CASE", kind)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            #[cfg(unix)]
            {
                let _ = Command::new("kill")
                    .args(["-TERM", "--", &format!("-{}", child.id())])
                    .status();
                for _ in 0..50 {
                    if child.try_wait()?.is_some() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                let _ = Command::new("kill")
                    .args(["-KILL", "--", &format!("-{}", child.id())])
                    .status();
            }
            let _ = child.kill();
            let output = child.wait_with_output()?;
            return Err(format!(
                "keeper {kind} timed out; stdout: {}; stderr: {}",
                sanitized_output(&output.stdout, &secrets),
                sanitized_output(&output.stderr, &secrets)
            )
            .into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let output = child.wait_with_output()?;
    // Only forward the harness's fixed, credential-free completion line.
    let expected = format!("sandbox smoke {kind}: complete");
    if String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line == expected)
    {
        println!("{expected}");
    }
    if !output.status.success() {
        return Err(format!(
            "keeper {kind} failed; stdout: {}; stderr: {}",
            sanitized_output(&output.stdout, &secrets),
            sanitized_output(&output.stderr, &secrets)
        )
        .into());
    }
    Ok(())
}

async fn keeper_case(worker: &SandboxWorker, kind: &str) -> Res<()> {
    let Env {
        mock,
        game,
        token: _,
    } = fixture(worker, 5).await?;
    let signer = worker.dev_create_account().await?;
    let racer = worker.dev_create_account().await?;
    // A wrong explicit target must not create a round or enqueue a mock request.
    let before = round(&game).await?;
    let ledger: Value = game.view("get_ledger").await?.json()?;
    let state_before = game.view_state().await?;
    let denied = signer
        .call(game.id(), "start_round")
        .args_json(json!({"mode":0,"round_id":1}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("wrong target accepted");
    assert!(format!("{denied:?}").contains("E50"));
    assert_eq!(round(&game).await?, before);
    assert_eq!(
        game.view_state().await?,
        state_before,
        "wrong target mutated contract state"
    );
    let after: Value = game.view("get_ledger").await?.json()?;
    // balance and locked_storage are runtime observations, not mutable game state.
    for field in [
        "credit",
        "round_pots",
        "carry",
        "compute_float",
        "storage_reserve",
        "pending_referee_requests",
    ] {
        assert_eq!(ledger[field], after[field], "wrong target changed {field}");
    }
    let count: String = mock.view("request_count").await?.json()?;
    assert_eq!(count, "0");
    if kind == "pending" {
        let begin = signer
            .call(game.id(), "start_round")
            .args_json(json!({"mode":0,"round_id":0}))
            .max_gas()
            .transact_async()
            .await?;
        wait_requests(&mock, 1).await?;
        let sealing = phase(&game, "Sealing").await?;
        assert_eq!(sealing["begin_status"], "pending");
        keeper(worker, &game, &signer, &racer, kind).await?;
        assert_eq!(round(&game).await?["begin_status"], "pending");
        resolve(&mock, 0, begin_value(&"11".repeat(32)), false).await?;
        tokio::time::timeout(Duration::from_secs(30), begin)
            .await??
            .into_result()?;
    } else {
        start(&game, &mock, &"11".repeat(32)).await?;
        let state = round(&game).await?;
        due(
            worker,
            state["investigation_end_ns"]
                .as_u64()
                .ok_or("missing deadline")?,
            90,
        )
        .await?;
        keeper(worker, &game, &signer, &racer, kind).await?;
        let reveal = phase(&game, "Reveal").await?;
        assert_eq!(
            reveal["freeze_ns"], state["investigation_end_ns"],
            "late keeper moved logical freeze"
        );
        let deadline = state["investigation_end_ns"]
            .as_u64()
            .ok_or("missing deadline")?
            + 300 * SECOND;
        assert_eq!(
            reveal["reveal_deadline_ns"], deadline,
            "late keeper extended Reveal"
        );
        let duplicate = signer
            .call(game.id(), "advance")
            .args_json(json!({"mode":0,"round_id":0}))
            .max_gas()
            .transact()
            .await?
            .into_result()
            .expect_err("duplicate advance accepted");
        assert!(format!("{duplicate:?}").contains("E10"));
        assert_eq!(round(&game).await?, reveal);
    }
    Ok(())
}

async fn season(worker: &SandboxWorker) -> Res<()> {
    let Env {
        mock,
        game,
        token: _,
    } = fixture(worker, 120).await?;
    let mut actors = Vec::new();
    for _ in 0..21 {
        actors.push(worker.dev_create_account().await?);
    }
    // Even-number predicate, so each unique odd number below has a genuine NO.
    let rule: rule_core::CanonicalRule =
        serde_json::from_value(json!({"v":"g1","form":0,"lits":[[0,0]]}))?;
    let commitment = serde_json::to_value(protocol::round_commitment(&rule, &[5; 32]))?;
    let initial_storage = game.view_account().await?.storage_usage;
    for actor in &actors {
        actor
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let funded_accounts_storage = game.view_account().await?.storage_usage;
    assert!(funded_accounts_storage.saturating_sub(initial_storage) <= 21 * 512);
    start(&game, &mock, commitment.as_str().ok_or("bad commitment")?).await?;
    for (i, actor) in actors.iter().enumerate() {
        let play = actor
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":2*i+1,"word":"otter"}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, i as u32 + 2).await?;
        resolve(&mock, i as u32 + 1, json!({"v":0}), false).await?;
        tokio::time::timeout(Duration::from_secs(30), play)
            .await??
            .into_result()?;
        for _ in 0..100 {
            let rows: Vec<Value> = game
                .view("get_log")
                .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
                .await?
                .json()?;
            if rows.len() == i + 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let entity: Value = game
            .view("get_entity")
            .args_json(json!({"mode":0,"id":0,"account":actor.id()}))
            .await?
            .json()?;
        assert_eq!(entity["shares"], 1);
        assert_eq!(entity["pending"], false);
    }
    let state = round(&game).await?;
    due(
        worker,
        state["investigation_end_ns"]
            .as_u64()
            .ok_or("missing deadline")?,
        200,
    )
    .await?;
    actors[0]
        .call(game.id(), "advance")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let reveal = phase(&game, "Reveal").await?;
    due(
        worker,
        reveal["reveal_deadline_ns"]
            .as_u64()
            .ok_or("missing reveal deadline")?,
        400,
    )
    .await?;
    let opening = actors[0]
        .call(game.id(), "finalize")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&mock, 23).await?;
    resolve(
        &mock,
        22,
        json!({"rule":rule,"salt":"05".repeat(32)}),
        false,
    )
    .await?;
    tokio::time::timeout(Duration::from_secs(30), opening)
        .await??
        .into_result()?;
    let settled = phase(&game, "Settled").await?;
    assert_eq!(settled["outcome"]["kind"], "Unsolved");
    let before_index = game.view_account().await?.storage_usage;
    let batch = actors[0]
        .call(game.id(), "index_season")
        .args_json(json!({"mode":0,"season":0,"limit":20}))
        .max_gas()
        .transact()
        .await?;
    let gas = batch.total_gas_burnt.as_gas();
    batch.into_result()?;
    let after_first = game.view_account().await?.storage_usage;
    let status: Value = game
        .view("get_season_status")
        .args_json(json!({"mode":0,"season":0}))
        .await?
        .json()?;
    assert_eq!(status["indexed"], 20);
    assert_eq!(status["total"], 21);
    assert_eq!(status["ready"], false);
    let not_ready = game
        .view("get_season")
        .args_json(json!({"mode":0,"season":0,"from":null,"limit":20}))
        .await
        .expect_err("partial board exposed");
    assert!(format!("{not_ready:?}").contains("E50"));
    actors[0]
        .call(game.id(), "index_season")
        .args_json(json!({"mode":0,"season":0,"limit":20}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let status: Value = game
        .view("get_season_status")
        .args_json(json!({"mode":0,"season":0}))
        .await?
        .json()?;
    assert_eq!(status["indexed"], 21);
    assert_eq!(status["total"], 21);
    assert_eq!(status["ready"], true);
    let mut rows = Vec::<Value>::new();
    let mut cursor = Value::Null;
    loop {
        let page: Vec<Value> = game
            .view("get_season")
            .args_json(json!({"mode":0,"season":0,"from":cursor,"limit":7}))
            .await?
            .json()?;
        if page.is_empty() {
            break;
        }
        cursor = page.last().ok_or("empty page")?["cursor"].clone();
        rows.extend(page);
        assert!(rows.len() <= 21, "pagination repeated rows");
    }
    assert_eq!(rows.len(), 21);
    let ids: Vec<u64> = rows
        .iter()
        .map(|r| r["entity_id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids.iter().copied().collect::<BTreeSet<_>>().len(), 21);
    assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
    let pot = settled["pot"]
        .as_str()
        .ok_or("missing pot")?
        .parse::<u128>()?;
    let expected = (pot * 4000 / 10000) / 21;
    for row in &rows {
        assert_eq!(row["rounds_won"], 0);
        assert_eq!(row["shares"], 1);
        assert_eq!(row["earned"], expected.to_string());
    }
    let before_claim = rows.clone();
    actors[0]
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let full: Vec<Value> = game
        .view("get_season")
        .args_json(json!({"mode":0,"season":0,"from":null,"limit":200}))
        .await?
        .json()?;
    assert_eq!(full, before_claim, "claim changed season board");
    let end_storage = game.view_account().await?.storage_usage;
    let growth = end_storage.saturating_sub(initial_storage);
    let action_growth = end_storage.saturating_sub(funded_accounts_storage);
    assert!(
        action_growth <= 21 * 2048,
        "sample action growth exceeded funded 2,048-byte charges"
    );
    assert!(
        u128::from(growth) * BYTE_COST <= 21 * (512 + 2048) * BYTE_COST,
        "sample growth exceeded total funded charges"
    );
    println!(
        "season batch20 gas={gas}, storage_before={before_index}, storage_after={after_first}, account_growth={} bytes, action_growth={action_growth} bytes, total_sample_growth={growth} bytes; rows={}",
        funded_accounts_storage.saturating_sub(initial_storage),
        serde_json::to_string(&rows)?
    );
    Ok(())
}

async fn season_progress(worker: &SandboxWorker) -> Res<()> {
    let Env { mock, game, .. } = fixture(worker, 120).await?;
    let rule: rule_core::CanonicalRule =
        serde_json::from_value(json!({"v":"g1","form":0,"lits":[[0,0]]}))?;
    let commitment = serde_json::to_value(protocol::round_commitment(&rule, &[5; 32]))?;
    start(&game, &mock, commitment.as_str().ok_or("bad commitment")?).await?;
    let mut actors = Vec::new();
    let mut expected_ids = BTreeSet::new();
    for i in 0..4u32 {
        let actor = worker.dev_create_account().await?;
        actor
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .transact()
            .await?
            .into_result()?;
        let player: Value = game
            .view("get_player")
            .args_json(json!({"account":actor.id()}))
            .await?
            .json()?;
        expected_ids.insert(player["index"].as_u64().ok_or("missing player index")?);
        let play = actor
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":2*i+1,"word":"otter"}))
            .max_gas()
            .transact_async()
            .await?;
        wait_requests(&mock, i + 2).await?;
        resolve(&mock, i + 1, json!({"v":0}), false).await?;
        tokio::time::timeout(Duration::from_secs(30), play)
            .await??
            .into_result()?;
        let mut observed = 0;
        for _ in 0..100 {
            let rows: Vec<Value> = game
                .view("get_log")
                .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
                .await?
                .json()?;
            observed = rows.len();
            if observed == i as usize + 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        assert_eq!(observed, i as usize + 1, "verdict callback not observed");
        let entity: Value = game
            .view("get_entity")
            .args_json(json!({"mode":0,"id":0,"account":actor.id()}))
            .await?
            .json()?;
        assert_eq!(entity["shares"], 1);
        assert_eq!(entity["pending"], false);
        actors.push(actor);
        if i == 0 {
            continue;
        }
        let before: Value = game
            .view("get_season_status")
            .args_json(json!({"mode":0,"season":0}))
            .await?
            .json()?;
        assert_eq!(before["total"], i + 1);
        assert_eq!(before["indexed"], i - 1, "append discarded completed work");
        let batch = actors[0]
            .call(game.id(), "index_season")
            .args_json(json!({"mode":0,"season":0,"limit":1}))
            .max_gas()
            .transact()
            .await?;
        let gas = batch.total_gas_burnt.as_gas();
        batch.into_result()?;
        let status: Value = game
            .view("get_season_status")
            .args_json(json!({"mode":0,"season":0}))
            .await?
            .json()?;
        assert_eq!(status["indexed"], i);
        assert_eq!(status["revision"], before["revision"]);
        assert_eq!(status["ready"], false);
        println!(
            "season-progress candidates={} indexed={i} batch_gas={gas}",
            i + 1
        );
    }
    actors[0]
        .call(game.id(), "index_season")
        .args_json(json!({"mode":0,"season":0,"limit":20}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let rows: Vec<Value> = game
        .view("get_season")
        .args_json(json!({"mode":0,"season":0,"from":null,"limit":200}))
        .await?
        .json()?;
    assert_eq!(rows.len(), 4);
    assert_eq!(
        rows.iter()
            .map(|row| row["entity_id"].as_u64().unwrap())
            .collect::<BTreeSet<_>>(),
        expected_ids
    );
    assert!(
        rows.iter()
            .all(|row| row["shares"] == 0 && row["earned"] == "0")
    );
    println!(
        "season-progress actual WASM: append preserved indexing; four unique pre-settlement rows ready"
    );
    Ok(())
}

#[tokio::main]
async fn main() -> Res<()> {
    println!(
        "LOCAL MOCK: actual sandbox WASM; compressed demo schedule, not testnet or deployed Worker evidence"
    );
    let worker = near_workspaces::sandbox().await?;
    if let Some(case) = std::env::args().nth(1) {
        match case.as_str() {
            "season" => season(&worker).await?,
            "season-progress" => season_progress(&worker).await?,
            "advance" | "pending" | "race" | "worker" => keeper_case(&worker, &case).await?,
            _ => {
                return Err(
                    "expected advance, pending, race, worker, season or season-progress".into(),
                );
            }
        }
        return Ok(());
    }
    for kind in ["advance", "pending", "race", "worker"] {
        keeper_case(&worker, kind).await?;
    }
    season(&worker).await?;
    Ok(())
}
