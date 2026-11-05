//! Admission and recovery on actual game wasm with MOCK OutLayer; never testnet evidence.
mod common;

use common::*;
use near_workspaces::Contract;
use near_workspaces::types::NearToken;
use protocol::RuleHex;
use serde_json::{Value, json};

async fn pending(game: &Contract) -> Res<u64> {
    let ledger: Value = game.view("get_ledger").await?.json()?;
    ledger["pending_referee_requests"]
        .as_u64()
        .ok_or_else(|| "missing referee request count".into())
}

async fn wait_pending(game: &Contract, expected: u64) -> Res<()> {
    // Initiating transactions detach their callback chain; completion is a separate state transition.
    for _ in 0..50 {
        if pending(game).await? == expected {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!(
        "referee count did not reach {expected}; observed {}",
        pending(game).await?
    )
    .into())
}

#[tokio::test]
async fn saturated_plays_preserve_reveals_and_lifecycle_capacity() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, .. } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let config: Value = game.view("get_params").await?.json()?;
    assert_eq!(config["max_pending_referee_requests"], 10);
    assert_eq!(config["user_referee_request_limit"], 8);
    assert_eq!(pending(&game).await?, 0);
    let fee: u128 = config["play_fee"].as_str().unwrap().parse()?;
    let storage: u128 = config["storage_charge_per_play"]
        .as_str()
        .unwrap()
        .parse()?;
    let account_charge: u128 = config["storage_charge_account"].as_str().unwrap().parse()?;
    let deposit = NearToken::from_near(1).as_yoctonear();

    // The first interned player has Solo entity 0, as required by commit_hash's fixture.
    let guesser = worker.dev_create_account().await?;
    guesser
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let (rule, _) = rule_core::sample(b"sandbox-capacity");
    let hash = commit_hash(&game, &guesser, &rule, [9; 32]);
    let ack: Value = guesser
        .call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":hash}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    let stake: u128 = ack["stake"].as_str().unwrap().parse()?;
    let reveal_args = json!({"mode":0,"commit_seq":0,"guess":serde_json::to_value(RuleHex(rule))?,"salt":"09".repeat(32)});

    let mut players = Vec::new();
    let mut plays = Vec::new();
    for number in 100..108 {
        let actor = worker.dev_create_account().await?;
        actor
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let play = actor
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":number,"word":"otter"}))
            .max_gas()
            .transact_async()
            .await?;
        plays.push(play);
        players.push(actor);
        wait_requests(&mock, plays.len() as u32 + 1).await?;
        assert_eq!(pending(&game).await?, plays.len() as u64);
    }
    println!("MOCK OutLayer: eight distinct players have pending verdicts");

    // A capacity rejection rolls back the complete contract state, including ids and commitments.
    let state = game.view_state().await?;
    for (method, args) in [
        ("play", json!({"mode":0,"number":900,"word":"otter"})),
        ("reveal_guess", reveal_args.clone()),
    ] {
        let error = guesser
            .call(game.id(), method)
            .args_json(args)
            .max_gas()
            .transact()
            .await?
            .into_result()
            .expect_err("user capacity is full");
        assert!(format!("{error:?}").contains("E23"), "{error:?}");
        assert_eq!(
            game.view_state().await?,
            state,
            "{method} changed stored state"
        );
        assert_eq!(pending(&game).await?, 8);
    }
    assert_eq!(commits(&game).await?[0]["status"], "Committed");
    let count: String = mock.view("request_count").await?.json()?;
    assert_eq!(count, "9", "rejected calls must not reach OutLayer");

    // Team gameplay is not implemented yet; its real begin lifecycle can still use reserved room.
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":1}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&mock, 10).await?;
    assert_eq!(pending(&game).await?, 9);
    resolve(&mock, 9, Value::Null, false).await?;
    begin.await?.into_result()?;
    wait_pending(&game, 8).await?;

    // Completing one play releases exactly one admission, allowing the original reveal unchanged.
    resolve(&mock, 1, json!({"v":0}), false).await?;
    let mut plays = plays.into_iter();
    plays
        .next()
        .expect("eight pending plays")
        .await?
        .into_result()?;
    wait_pending(&game, 7).await?;
    let checking = guesser
        .call(game.id(), "reveal_guess")
        .args_json(reveal_args)
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&mock, 11).await?;
    assert_eq!(pending(&game).await?, 8);
    resolve(&mock, 10, json!({"correct":false}), false).await?;
    checking.await?.into_result()?;
    wait_status(&game, 0, "Wrong").await?;
    assert_eq!(pending(&game).await?, 7);
    assert_eq!(
        credit(&game, &guesser).await?,
        deposit - account_charge - storage - stake / 2
    );

    let replacement = guesser
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":900,"word":"otter"}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&mock, 12).await?;
    assert_eq!(pending(&game).await?, 8);
    resolve(&mock, 11, json!({"v":0}), false).await?;
    replacement.await?.into_result()?;
    wait_pending(&game, 7).await?;
    for (offset, play) in plays.enumerate() {
        resolve(&mock, offset as u32 + 2, Value::Null, false).await?;
        play.await?.into_result()?;
    }
    wait_pending(&game, 0).await?;
    for (index, actor) in players.iter().enumerate() {
        let expected = deposit - account_charge - if index == 0 { fee + storage } else { 0 };
        assert_eq!(credit(&game, actor).await?, expected);
    }
    assert_eq!(
        credit(&game, &guesser).await?,
        deposit - account_charge - 2 * storage - stake / 2 - fee
    );
    let rows: Vec<Value> = game
        .view("get_log")
        .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
        .await?
        .json()?;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["account"], players[0].id().as_str());
    assert_eq!(rows[1]["account"], guesser.id().as_str());
    let ledger: Value = game.view("get_ledger").await?.json()?;
    assert_eq!(ledger["pending_credit"], "0");
    assert_eq!(ledger["open_stakes"], "0");
    println!(
        "PASS: user cap=8; lifecycle admitted at 8; failed admission preserved state; reveal/replacement recovered; all owners reconciled"
    );
    Ok(())
}
