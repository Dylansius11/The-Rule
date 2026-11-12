//! Actual local game wasm with a MOCK OutLayer, not testnet.
mod common;

use common::{
    Res, finalize_with_open, resolve, start_with_open_timeout, wait_requests, wait_status,
};
use near_workspaces::Contract;
use near_workspaces::types::{Gas, NearToken};
use protocol::RuleHex;
use sandbox_tests::{artifact, params};
use serde_json::{Value, json};

#[tokio::test]
async fn begin_resolves_via_mock_outlayer() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let mock = worker
        .dev_deploy(&std::fs::read(artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let game = worker.dev_deploy(&std::fs::read(artifact("game"))?).await?;
    game.call("new")
        .args_json(json!({"params":params(mock.id().as_str(), worker.view_block().await?.timestamp()),"demo":true}))
        .transact()
        .await?
        .into_result()?;
    let config: Value = game.view("get_params").await?.json()?;
    assert_eq!(config["demo"], true);
    let error = game
        .call("play")
        .args_json(json!({"mode":0,"number":1,"word":"otter"}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("no round yet");
    assert!(format!("{error:?}").contains("E10"), "{error:?}");
    let result = game
        .call("start_round")
        .args_json(json!({"mode":0}))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact_async()
        .await?;
    for _ in 0..20 {
        let count: String = mock.view("request_count").await?.json()?;
        if count == "1" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    mock.call("resolve").args_json(json!({"id":0,"resolution":{"value":{"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}},"error":false}})).deposit(NearToken::from_yoctonear(0)).max_gas().transact().await?.into_result()?;
    let _ = result.await?;
    let mut ready = false;
    for _ in 0..30 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":null}))
            .await?
            .json()?;
        if round["phase"] == "Investigation" {
            assert_eq!(round["demo"], true);
            ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert!(ready, "begin callback did not transition to Investigation");
    let bob = worker.dev_create_account().await?;
    let error = bob
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":7,"word":"otter"}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("no credit");
    assert!(format!("{error:?}").contains("E20"), "{error:?}");
    let alice = worker.dev_create_account().await?;
    let base = game.view_account().await?.storage_usage;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    println!("deposit complete");
    let account = game.view_account().await?.storage_usage;
    println!("storage bytes account={}", account - base);
    for (number, word, expected) in [(1000, "otter", "E11"), (1, "unknown", "E11")] {
        let error = alice
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":number,"word":word}))
            .max_gas()
            .transact()
            .await?
            .into_result()
            .expect_err("invalid play must be rejected");
        assert!(format!("{error:?}").contains(expected), "{error:?}");
    }
    let error = alice
        .call(game.id(), "withdraw_credit")
        .args_json(json!({"amount":"1"}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("withdrawal needs one yocto");
    assert!(format!("{error:?}").contains("E51"), "{error:?}");
    let play = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":1,"word":"otter"}))
        .max_gas()
        .transact_async()
        .await?;
    for _ in 0..20 {
        let count: String = mock.view("request_count").await?.json()?;
        if count == "2" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let pending_error = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":2,"word":"otter"}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("entity pending");
    assert!(
        format!("{pending_error:?}").contains("E13"),
        "{pending_error:?}"
    );
    let pending_error = alice
        .call(game.id(), "withdraw_credit")
        .args_json(json!({"amount":"1"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("pending play blocks withdrawal");
    assert!(
        format!("{pending_error:?}").contains("E21"),
        "{pending_error:?}"
    );
    let pending = game.view_account().await?.storage_usage;
    mock.call("resolve")
        .args_json(json!({"id":1,"resolution":{"value":{"v":0},"error":false}}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    play.await?.into_result()?;
    let mut settled = false;
    for _ in 0..30 {
        let rows: Vec<Value> = game
            .view("get_log")
            .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
            .await?
            .json()?;
        if !rows.is_empty() {
            settled = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert!(settled, "verdict callback did not settle");
    let error = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":2,"word":"otter"}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("attempt limit");
    assert!(format!("{error:?}").contains("E14"), "{error:?}");
    let after = game.view_account().await?.storage_usage;
    let state = game.view_state().await?;
    let entity_storage: usize = state
        .iter()
        .filter(|(key, _)| key.first() == Some(&b'e'))
        .map(|(key, value)| key.len() + value.len() + 40)
        .sum();
    assert!(entity_storage > 0);
    println!("storage bytes solo_entity_record={entity_storage}");
    println!(
        "storage bytes account={} first_play_pending_delta={} first_play_settled_delta={}",
        account - base,
        pending - account,
        after - account
    );
    Ok(())
}

async fn wait_round(game: &Contract, field: &str, expected: &str) -> Res<Value> {
    for _ in 0..50 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":0}))
            .await?
            .json()?;
        if round[field] == expected {
            return Ok(round);
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!("round {field} never became {expected}").into())
}

// Cancellation uses real sandbox block timestamps, not patched contract state.
async fn cancel_after_deadline(game: &Contract) -> Res<()> {
    for _ in 0..80 {
        let result = game
            .call("cancel")
            .args_json(json!({"mode":0,"round_id":0}))
            .max_gas()
            .transact()
            .await?;
        match result.into_result() {
            Ok(_) => return Ok(()),
            Err(error) if format!("{error:?}").contains("E50") => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            Err(error) => return Err(format!("unexpected cancel failure: {error:?}").into()),
        }
    }
    Err("cancellation deadline did not elapse".into())
}

async fn reject_without_lifecycle_effects(
    game: &Contract,
    mock: &Contract,
    method: &str,
    args: Value,
    code: &str,
) -> Res<()> {
    let before: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    let ledger: Value = game.view("get_ledger").await?.json()?;
    let count: String = mock.view("request_count").await?.json()?;
    let error = game
        .call(method)
        .args_json(args)
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("forbidden lifecycle transition");
    assert!(format!("{error:?}").contains(code), "{error:?}");
    let after: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    let after_ledger: Value = game.view("get_ledger").await?.json()?;
    let after_count: String = mock.view("request_count").await?.json()?;
    assert_eq!(after, before);
    assert_eq!(
        after_ledger["pending_referee_requests"],
        ledger["pending_referee_requests"]
    );
    assert_eq!(after_count, count);
    Ok(())
}

#[tokio::test]
async fn failed_begin_retries_then_cancels_after_deadline() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let mock = worker
        .dev_deploy(&std::fs::read(artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let game = worker.dev_deploy(&std::fs::read(artifact("game"))?).await?;
    let mut config = params(mock.id().as_str(), worker.view_block().await?.timestamp());
    config["begin_timeout_ns"] = json!(30_000_000_000u64);
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    for id in 0..2 {
        let begin = game
            .call("start_round")
            .args_json(json!({"mode":0}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, id + 1).await?;
        if id == 0 {
            reject_without_lifecycle_effects(&game, &mock, "start_round", json!({"mode":0}), "E50")
                .await?;
            reject_without_lifecycle_effects(
                &game,
                &mock,
                "retry_open",
                json!({"mode":0,"round_id":0}),
                "E10",
            )
            .await?;
        }
        resolve(&mock, id, Value::Null, true).await?;
        begin.await?.into_result()?;
        let round = wait_round(&game, "begin_status", "failed").await?;
        assert_eq!(round["phase"], "Sealing");
    }
    cancel_after_deadline(&game).await?;
    wait_round(&game, "phase", "Cancelled").await?;
    Ok(())
}

#[tokio::test]
async fn failed_open_retries_then_cancels_after_deadline() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let (rule, _) = rule_core::sample(b"sandbox-open-retry-cancel");
    let commitment = serde_json::to_value(protocol::round_commitment(&rule, &[5u8; 32]))?;
    let common::Env { mock, game, .. } = start_with_open_timeout(
        &worker,
        commitment.as_str().unwrap(),
        3_000_000_000,
        Some(30_000_000_000),
    )
    .await?;
    let alice = worker.dev_create_account().await?;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let hash = common::commit_hash(&game, &alice, &rule, [9u8; 32]);
    alice
        .call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":hash}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    worker.fast_forward(5).await?;
    let guess = alice.call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":0,"guess":serde_json::to_value(RuleHex(rule))?,"salt":"09".repeat(32)}))
        .gas(Gas::from_tgas(300)).transact_async().await?;
    wait_requests(&mock, 2).await?;
    resolve(&mock, 1, json!({"correct":true}), false).await?;
    guess.await?.into_result()?;
    wait_status(&game, 0, "Correct").await?;
    // finalize_with_open resumes the mock before awaiting its yielded parent.
    finalize_with_open(&worker, &alice, &game, &mock, 0, 2, Value::Null).await?;
    wait_round(&game, "open_status", "failed").await?;
    let retry = alice
        .call(game.id(), "retry_open")
        .args_json(json!({"mode":0,"round_id":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 4).await?;
    reject_without_lifecycle_effects(
        &game,
        &mock,
        "retry_open",
        json!({"mode":0,"round_id":0}),
        "E10",
    )
    .await?;
    reject_without_lifecycle_effects(
        &game,
        &mock,
        "cancel",
        json!({"mode":0,"round_id":0}),
        "E50",
    )
    .await?;
    resolve(&mock, 3, Value::Null, true).await?;
    retry.await?.into_result()?;
    wait_round(&game, "open_status", "failed").await?;
    cancel_after_deadline(&game).await?;
    wait_round(&game, "phase", "Cancelled").await?;
    let before = common::credit(&game, &alice).await?;
    let returned: String = alice
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert_eq!(returned, "100000000000000000000000");
    assert_eq!(
        common::credit(&game, &alice).await? - before,
        returned.parse::<u128>()?
    );
    Ok(())
}
