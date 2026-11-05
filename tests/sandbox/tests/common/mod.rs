//! Helpers shared by the sandbox tests. Everything here talks to a MOCK OutLayer, never testnet.
#![allow(dead_code)]
use near_workspaces::network::Sandbox;
use near_workspaces::types::Gas;
use near_workspaces::{Account, Contract, Worker};
use protocol::{CommitPreimage, Entity, Mode};
use sandbox_tests::{artifact, params};
use serde_json::{Value, json};

pub type Res<T> = Result<T, Box<dyn std::error::Error>>;
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

/// Deploy mock, token and game, wire them together, run `start_round` and deliver a begin result
/// sealed with `commit`; the round ends in Investigation with a `reveal_window_ns` of `window_ns`.
pub async fn start(worker: &Worker<Sandbox>, commit: &str, window_ns: u64) -> Res<Env> {
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
    let mut config = params(mock.id().as_str());
    config["reveal_window_ns"] = json!(window_ns);
    config["token"] = json!(token.id());
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
