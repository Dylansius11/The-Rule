//! Solo play receipts against local game/token wasm and MOCK OutLayer, not testnet.
mod common;

use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use protocol::RuleHex;
use sandbox_tests::{artifact, params};
use serde_json::{Value, json};

async fn deposit(game: &Contract, player: &Account) -> Res<()> {
    player
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn register(game: &Contract, token: &Contract, player: &Account) -> Res<()> {
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let min = bounds["min"].as_str().unwrap().parse()?;
    player
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":player.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(min))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    player
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    for _ in 0..30 {
        let state: String = game
            .view("get_token_state")
            .args_json(json!({"account":player.id()}))
            .await?
            .json()?;
        if state == "registered" {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Err("token registration did not complete".into())
}

async fn entity(game: &Contract, player: &Account) -> Res<Value> {
    Ok(game
        .view("get_entity")
        .args_json(json!({"mode":0,"id":0,"account":player.id()}))
        .await?
        .json()?)
}

async fn wait_play(game: &Contract, player: &Account) -> Res<()> {
    for _ in 0..50 {
        if entity(game, player).await?["pending"] == false {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("detached verdict callback did not clear the player's pending state".into())
}
async fn round(game: &Contract) -> Res<Value> {
    Ok(game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?)
}
async fn ledger(game: &Contract) -> Res<Value> {
    let mut v: Value = game.view("get_ledger").await?.json()?;
    // Runtime balance and storage-byte costs are not player liabilities.
    v.as_object_mut().unwrap().remove("balance");
    v.as_object_mut().unwrap().remove("locked_storage");
    Ok(v)
}
async fn log(game: &Contract) -> Res<Vec<Value>> {
    Ok(game
        .view("get_log")
        .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
        .await?
        .json()?)
}
async fn supply(token: &Contract) -> Res<String> {
    Ok(token.view("ft_total_supply").await?.json()?)
}
async fn token_balance(token: &Contract, player: &Account) -> Res<String> {
    Ok(token
        .view("ft_balance_of")
        .args_json(json!({"account_id":player.id()}))
        .await?
        .json()?)
}
async fn count(mock: &Contract) -> Res<u32> {
    let value: String = mock.view("request_count").await?.json()?;
    Ok(value.parse()?)
}
async fn requested_play(mock: &Contract, id: u32) -> Res<Value> {
    let request: Value = mock
        .view("get_request")
        .args_json(json!({"id":id}))
        .await?
        .json()?;
    let input: Value = serde_json::from_str(request[1].as_str().unwrap())?;
    Ok(input["play"].clone())
}
async fn verdict(game: &Contract, play: &Value) -> Res<Value> {
    Ok(game
        .view("get_verdict")
        .args_json(json!({"mode":0,"id":0,"play":play}))
        .await?
        .json()?)
}
fn amount(v: &Value, field: &str) -> u128 {
    v[field].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn verdict_failure_shapes_refund_and_allow_retry() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, token } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let alice = worker.dev_create_account().await?;
    deposit(&game, &alice).await?;
    register(&game, &token, &alice).await?;
    let config: Value = game.view("get_params").await?.json()?;
    let charge = amount(&config, "play_fee") + amount(&config, "storage_charge_per_play");
    let initial_credit = credit(&game, &alice).await?;
    let initial_ledger = ledger(&game).await?;
    let initial_entity = entity(&game, &alice).await?;
    let initial_round = round(&game).await?;
    let cases = [
        (Value::Null, false),
        (Value::Null, true),
        (json!({"v":2}), false),
        (json!({"v":1,"extra":true}), false),
        (json!({"correct":true}), false),
    ];
    for (index, (response, error)) in cases.into_iter().enumerate() {
        let id = index as u32 + 1;
        let play = alice
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":17,"word":"otter"}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, id + 1).await?;
        let requested = requested_play(&mock, id).await?;
        assert_eq!(credit(&game, &alice).await?, initial_credit - charge);
        let pending = ledger(&game).await?;
        assert_eq!(
            amount(&pending, "credit"),
            amount(&initial_ledger, "credit") - charge
        );
        assert_eq!(
            amount(&pending, "pending_credit"),
            amount(&initial_ledger, "pending_credit") + charge
        );
        assert_eq!(entity(&game, &alice).await?["attempts"], 1);
        if index == 0 {
            let denied = alice
                .call(game.id(), "on_verdict")
                .args_json(json!({"request_id":2}))
                .max_gas()
                .transact()
                .await?
                .into_result();
            assert!(denied.is_err(), "external callback must be private");
            assert_eq!(ledger(&game).await?, pending);
            assert_eq!(entity(&game, &alice).await?["attempts"], 1);
        }
        resolve(&mock, id, response, error).await?;
        play.await?.into_result()?;
        wait_play(&game, &alice).await?;
        assert_eq!(credit(&game, &alice).await?, initial_credit);
        assert_eq!(ledger(&game).await?, initial_ledger);
        assert_eq!(entity(&game, &alice).await?, initial_entity);
        assert_eq!(round(&game).await?, initial_round);
        assert!(log(&game).await?.is_empty());
        assert!(verdict(&game, &requested).await?.is_null());
        assert_eq!(supply(&token).await?, "0");
        assert_eq!(token_balance(&token, &alice).await?, "0");
    }
    // The same input is admitted again, not mistaken for a settled or pending play.
    let retry = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":17,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 7).await?;
    resolve(&mock, 6, json!({"v":0}), false).await?;
    retry.await?.into_result()?;
    wait_play(&game, &alice).await?;
    assert_eq!(log(&game).await?.len(), 1);
    assert_eq!(entity(&game, &alice).await?["attempts"], 1);
    assert_eq!(credit(&game, &alice).await?, initial_credit - charge);
    Ok(())
}

#[tokio::test]
async fn settled_duplicate_is_free_and_stateless() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, token } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    // NO leaves the player's previous-YES context empty. With a one-attempt limit,
    // a minute rollover gives E14 without a new request or state change; retry with
    // a fresh player and fresh row rather than assuming timestamps remain fixed.
    for n in 0..5u16 {
        let alice = worker.dev_create_account().await?;
        deposit(&game, &alice).await?;
        let id = count(&mock).await?;
        let play = alice
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":100+n,"word":"otter"}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, id + 1).await?;
        resolve(&mock, id, json!({"v":0}), false).await?;
        play.await?.into_result()?;
        wait_play(&game, &alice).await?;
        let rows = log(&game).await?;
        let row = rows.last().unwrap();
        let words: Vec<String> = game.view("get_word_list").await?.json()?;
        let word = &words[row["play"]["word_id"].as_u64().unwrap() as usize];
        let before_entity = entity(&game, &alice).await?;
        let before_credit = credit(&game, &alice).await?;
        let before_ledger = ledger(&game).await?;
        let before_round = round(&game).await?;
        let before_supply = supply(&token).await?;
        let before_count = count(&mock).await?;
        let result = alice
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":row["play"]["number"],"word":word}))
            .max_gas()
            .transact()
            .await?;
        let outcome = result.into_result();
        match outcome {
            Ok(ok) => {
                let ack: Value = ok.json()?;
                assert_eq!(
                    ack,
                    json!({"status":"Known","verdict":false,"log_idx":row["log_idx"]})
                );
                assert_eq!(count(&mock).await?, before_count);
                assert_eq!(log(&game).await?, rows);
                assert_eq!(entity(&game, &alice).await?, before_entity);
                assert_eq!(credit(&game, &alice).await?, before_credit);
                assert_eq!(ledger(&game).await?, before_ledger);
                assert_eq!(round(&game).await?, before_round);
                assert_eq!(supply(&token).await?, before_supply);
                return Ok(());
            }
            Err(err) => assert!(format!("{err:?}").contains("E14"), "{err:?}"),
        }
    }
    Err("duplicate context crossed a minute boundary in all five attempts".into())
}

#[tokio::test]
async fn delayed_yes_after_correct_guess_refunds_without_settlement() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, token } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let alice = worker.dev_create_account().await?;
    deposit(&game, &alice).await?;
    register(&game, &token, &alice).await?;
    let (rule, _) = rule_core::sample(b"delayed-solo-verdict");
    let salt = [9u8; 32];
    let hash = commit_hash(&game, &alice, &rule, salt);
    alice
        .call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":hash}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    worker.fast_forward(5).await?;
    let before_credit = credit(&game, &alice).await?;
    let before_ledger = ledger(&game).await?;
    let config: Value = game.view("get_params").await?.json()?;
    let charge = amount(&config, "play_fee") + amount(&config, "storage_charge_per_play");
    let play = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":27,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    let requested = requested_play(&mock, 1).await?;
    assert_eq!(credit(&game, &alice).await?, before_credit - charge);
    assert_eq!(
        amount(&ledger(&game).await?, "pending_credit"),
        amount(&before_ledger, "pending_credit") + charge
    );
    let check = alice.call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":0,"guess":serde_json::to_value(RuleHex(rule))?,"salt":"09".repeat(32)}))
        .gas(Gas::from_tgas(300)).transact_async().await?;
    wait_requests(&mock, 3).await?;
    resolve(&mock, 2, json!({"correct":true}), false).await?;
    check.await?.into_result()?;
    wait_status(&game, 0, "Correct").await?;
    assert_eq!(round(&game).await?["phase"], "Reveal");
    let frozen_ledger = ledger(&game).await?;
    let frozen_round = round(&game).await?;
    resolve(&mock, 1, json!({"v":1}), false).await?;
    play.await?.into_result()?;
    wait_play(&game, &alice).await?;
    assert_eq!(credit(&game, &alice).await?, before_credit);
    let after = ledger(&game).await?;
    assert_eq!(
        amount(&after, "credit"),
        amount(&frozen_ledger, "credit") + charge
    );
    assert_eq!(
        amount(&after, "pending_credit") + charge,
        amount(&frozen_ledger, "pending_credit")
    );
    for field in [
        "round_pots",
        "compute_float",
        "platform_accrued",
        "storage_reserve",
        "open_stakes",
        "claimable",
    ] {
        assert_eq!(after[field], frozen_ledger[field], "{field}");
    }
    let state = entity(&game, &alice).await?;
    assert_eq!(state["attempts"], 0);
    assert_eq!(state["shares"], 0);
    assert_eq!(state["pending"], false);
    assert_eq!(round(&game).await?, frozen_round);
    assert!(log(&game).await?.is_empty());
    assert!(verdict(&game, &requested).await?.is_null());
    assert_eq!(supply(&token).await?, "0");
    assert_eq!(token_balance(&token, &alice).await?, "0");
    Ok(())
}

#[tokio::test]
async fn low_compute_and_external_callback_are_rejected_without_effects() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let mock = worker
        .dev_deploy(&std::fs::read(artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let game = worker.dev_deploy(&std::fs::read(artifact("game"))?).await?;
    let mut config = params(mock.id().as_str());
    config["outlayer_deposit"]["verdict"] = json!("1");
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":0}))
        .max_gas()
        .transact_async()
        .await?;
    wait_requests(&mock, 1).await?;
    resolve(&mock, 0, begin_value(&"11".repeat(32)), false).await?;
    begin.await?.into_result()?;
    let alice = worker.dev_create_account().await?;
    deposit(&game, &alice).await?;
    let before = ledger(&game).await?;
    let before_credit = credit(&game, &alice).await?;
    let before_entity = entity(&game, &alice).await?;
    let err = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":3,"word":"otter"}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("empty compute float must reject play");
    assert!(format!("{err:?}").contains("E22"), "{err:?}");
    assert!(
        alice
            .call(game.id(), "on_verdict")
            .args_json(json!({"request_id":0}))
            .max_gas()
            .transact()
            .await?
            .into_result()
            .is_err()
    );
    assert_eq!(count(&mock).await?, 1);
    assert_eq!(credit(&game, &alice).await?, before_credit);
    assert_eq!(ledger(&game).await?, before);
    assert_eq!(entity(&game, &alice).await?, before_entity);
    assert!(log(&game).await?.is_empty());
    Ok(())
}
