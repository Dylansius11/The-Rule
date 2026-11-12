//! Helpers shared by the sandbox tests. Everything here talks to a MOCK OutLayer, never testnet.
#![allow(dead_code)]
use near_workspaces::network::Sandbox;
use near_workspaces::types::Gas;
use near_workspaces::{Account, Contract, Worker};
use protocol::{CommitPreimage, Entity, Mode};
use sandbox_tests::{artifact, params};
use serde_json::{Value, json};

pub type Res<T> = Result<T, Box<dyn std::error::Error>>;
/// Key-retaining sandbox instrumentation: rename selected callback exports only.
/// Restoring the original code does not replay a failed native callback.
pub fn mask_callback_exports(
    wasm: &[u8],
    names: &[&str],
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut fault = wasm.to_vec();
    let mut found = 0;
    for payload in wasmparser::Parser::new(0).parse_all(wasm) {
        if let wasmparser::Payload::ExportSection(section) = payload? {
            for export in section {
                let export = export?;
                if names.contains(&export.name) {
                    let start = export.name.as_ptr() as usize - wasm.as_ptr() as usize;
                    fault[start..start + export.name.len()].fill(b'x');
                    found += 1;
                }
            }
        }
    }
    if found != names.len() {
        return Err("fault fixture did not find every requested callback export".into());
    }
    wasmparser::Validator::new().validate_all(&fault)?;
    Ok(fault)
}

pub async fn fund_token_operations(token: &Contract) -> Res<()> {
    token
        .call("fund_operations")
        .deposit(near_workspaces::types::NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

pub fn check_token_outcome(call: &Value, status: &Value, kind: &str, applied: bool) -> Res<()> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let args: Value = serde_json::from_slice(
        &STANDARD.decode(call["args"].as_str().ok_or("missing call args")?)?,
    )?;
    let outcome: protocol::token::TokenOutcome = serde_json::from_slice(
        &STANDARD.decode(
            status["SuccessValue"]
                .as_str()
                .ok_or("missing token return")?,
        )?,
    )?;
    let expected = if applied {
        "applied"
    } else {
        "receiver_unregistered"
    };
    let result = serde_json::to_value(&outcome)?;
    if result["operation"] != args["operation"]
        || result["operation"]["kind"] != kind
        || result["status"] != expected
    {
        return Err(format!("unexpected token outcome: {result}; call: {args}").into());
    }
    Ok(())
}
pub const WINDOW_NS: u64 = 60_000_000_000;

pub struct Env {
    pub mock: Contract,
    pub game: Contract,
    pub token: Contract,
}

pub fn begin_value(commit: &str) -> Value {
    json!({"commit":commit,"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}})
}

pub async fn wait_status(game: &Contract, commit_seq: usize, status: &str) -> Res<()> {
    for _ in 0..50 {
        if commits(game).await?[commit_seq]["status"] == status {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!("commit {commit_seq} never became {status}").into())
}

pub async fn wait_requests(mock: &Contract, n: u32) -> Res<()> {
    for _ in 0..50 {
        let count: String = mock.view("request_count").await?.json()?;
        if count.parse::<u32>()? >= n {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!("mock never saw request {n}").into())
}

pub async fn resolve(mock: &Contract, id: u32, value: Value, error: bool) -> Res<()> {
    mock.call("resolve")
        .args_json(json!({"id":id,"resolution":{"value":value,"error":error}}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// Resume the mock open before awaiting its parent transaction. Only a rejected
/// pre-deadline E50 permits another finalize; never resend a live successful one.
pub async fn finalize_with_open(
    worker: &Worker<Sandbox>,
    actor: &Account,
    game: &Contract,
    mock: &Contract,
    mode: u8,
    mock_id: u32,
    opened: Value,
) -> Res<u64> {
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        worker.fast_forward(2).await?;
        let attempt = actor
            .call(game.id(), "finalize")
            .args_json(json!({"mode":mode}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        let attempt = std::future::IntoFuture::into_future(attempt);
        tokio::pin!(attempt);
        let completed = tokio::select! {
            result = &mut attempt => Some(result?),
            ready = wait_requests(mock, mock_id + 1) => {
                ready?;
                None
            }
        };
        let completed = match completed {
            Some(result) if !result.is_success() => {
                let error = result.into_result().expect_err("failed finalize");
                if !format!("{error:?}").contains("E50") {
                    return Err(format!("unexpected finalize failure: {error:?}").into());
                }
                continue;
            }
            other => other,
        };
        wait_requests(mock, mock_id + 1).await?;
        resolve(mock, mock_id, opened, false).await?;
        let result = match completed {
            Some(result) => result,
            None => tokio::time::timeout(std::time::Duration::from_secs(30), attempt).await??,
        };
        return result
            .into_result()?
            .json::<Option<u64>>()?
            .ok_or_else(|| "finalize did not schedule open".into());
    }
    Err("finalize deadline not reached".into())
}

/// Deploy mock, token and game, wire them together, run `start_round` and deliver a begin result
/// sealed with `commit`; the round ends in Investigation with a `reveal_window_ns` of `window_ns`.
pub async fn start(worker: &Worker<Sandbox>, commit: &str, window_ns: u64) -> Res<Env> {
    start_with_open_timeout(worker, commit, window_ns, None).await
}

pub async fn start_with_open_timeout(
    worker: &Worker<Sandbox>,
    commit: &str,
    window_ns: u64,
    open_timeout_ns: Option<u64>,
) -> Res<Env> {
    start_configured(worker, commit, window_ns, open_timeout_ns, 0, None).await
}

pub async fn start_seeded(
    worker: &Worker<Sandbox>,
    commit: &str,
    window_ns: u64,
    seed: near_workspaces::types::NearToken,
) -> Res<Env> {
    start_configured(worker, commit, window_ns, None, seed.as_yoctonear(), None).await
}

pub async fn start_with_period(
    worker: &Worker<Sandbox>,
    commit: &str,
    window_ns: u64,
    period_ns: u64,
) -> Res<Env> {
    start_configured(worker, commit, window_ns, None, 0, Some(period_ns)).await
}

async fn start_configured(
    worker: &Worker<Sandbox>,
    commit: &str,
    window_ns: u64,
    open_timeout_ns: Option<u64>,
    seed: u128,
    period_ns: Option<u64>,
) -> Res<Env> {
    let mock = worker
        .dev_deploy(&std::fs::read(artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let game = worker.dev_deploy(&std::fs::read(artifact("game"))?).await?;
    let token = worker
        .dev_deploy(&std::fs::read(artifact("token"))?)
        .await?;
    token
        .call("new")
        .args_json(json!({
            "minter": game.id(),
            "cap": "1000000000000000000000000000",
            "metadata": {"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}
        }))
        .transact()
        .await?
        .into_result()?;
    fund_token_operations(&token).await?;
    let mut config = params(mock.id().as_str(), worker.view_block().await?.timestamp());
    config["reveal_window_ns"] = json!(window_ns);
    if let Some(timeout) = open_timeout_ns {
        config["open_timeout_ns"] = json!(timeout);
    }
    if let Some(period) = period_ns {
        config["round_period_ns"] = json!(period);
    }
    config["token"] = json!(token.id());
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    if seed != 0 {
        game.call("seed_pot")
            .args_json(json!({"mode":0}))
            .deposit(near_workspaces::types::NearToken::from_yoctonear(seed))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 1).await?;
    resolve(&mock, 0, begin_value(commit), false).await?;
    begin.await?.into_result()?;
    for _ in 0..30 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":null}))
            .await?
            .json()?;
        if round["phase"] == "Investigation" {
            return Ok(Env { mock, game, token });
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("round never reached Investigation".into())
}

pub fn commit_hash(
    game: &Contract,
    actor: &Account,
    rule: &rule_core::CanonicalRule,
    salt: [u8; 32],
) -> String {
    let hash = protocol::commit_hash(&CommitPreimage {
        chain: "testnet",
        game: game.id().as_str(),
        mode: Mode::Solo,
        round: 0,
        actor: actor.id().as_str(),
        entity: Entity::Solo(0),
        guess: rule,
        salt: &salt,
    });
    serde_json::to_value(hash)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

pub async fn commits(game: &Contract) -> Res<Vec<Value>> {
    Ok(game
        .view("get_commits")
        .args_json(json!({"mode":0,"id":0,"from":0,"limit":200}))
        .await?
        .json()?)
}

pub async fn credit(game: &Contract, who: &Account) -> Res<u128> {
    let player: Value = game
        .view("get_player")
        .args_json(json!({"account":who.id()}))
        .await?
        .json()?;
    Ok(player["credit"].as_str().unwrap().parse()?)
}
