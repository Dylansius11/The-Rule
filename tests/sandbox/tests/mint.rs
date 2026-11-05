//! Mint, lock and unlock on the real game and token wasm with the MOCK OutLayer (never testnet evidence).
mod common;

use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{Value, json};

const RULE: u128 = 1_000_000_000_000_000_000;

async fn balance(token: &Contract, who: &str) -> Res<u128> {
    let value: String = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":who}))
        .await?
        .json()?;
    Ok(value.parse()?)
}

async fn wait_balance(token: &Contract, who: &str, expected: u128) -> Res<()> {
    for _ in 0..60 {
        if balance(token, who).await? == expected {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Err(format!(
        "{who} never reached balance {expected}, has {}",
        balance(token, who).await?
    )
    .into())
}

async fn lock_view(game: &Contract, who: &Account, round: u32) -> Res<u128> {
    let value: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":round,"account":who.id()}))
        .await?
        .json()?;
    Ok(value.parse()?)
}

async fn wait_token_state(game: &Contract, who: &Account, expected: &str) -> Res<()> {
    for _ in 0..30 {
        let state: String = game
            .view("get_token_state")
            .args_json(json!({"account":who.id()}))
            .await?
            .json()?;
        if state == expected {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Err(format!("token state for {} never became {expected}", who.id()).into())
}

#[tokio::test]
async fn accept_mints_real_rule_and_a_lock_round_trips_through_the_token() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, token } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let min: u128 = bounds["min"].as_str().unwrap().parse()?;
    // The game receives locked RULE, so it needs a token account too.
    token
        .call("storage_deposit")
        .args_json(json!({"account_id":game.id()}))
        .deposit(NearToken::from_yoctonear(min))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let alice = worker.dev_create_account().await?;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let before = credit(&game, &alice).await?;
    // Before token registration the game check returns to None without spending credit.
    alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    wait_token_state(&game, &alice, "none").await?;
    assert_eq!(before, credit(&game, &alice).await?);
    // Each player funds token storage directly; game credit is never used for registration.
    alice
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":alice.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(min))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    wait_token_state(&game, &alice, "registered").await?;
    assert_eq!(before, credit(&game, &alice).await?);
    alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(before, credit(&game, &alice).await?);
    wait_token_state(&game, &alice, "registered").await?;

    // One ACCEPT mints mint_base (100 RULE) of a Rare round at a full allowance.
    let play = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":2,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    resolve(&mock, 1, json!({"v":1}), false).await?;
    play.await?.into_result()?;
    wait_balance(&token, alice.id().as_str(), 100 * RULE).await?;
    let rows: Vec<Value> = game
        .view("get_log")
        .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
        .await?
        .json()?;
    assert_eq!(rows[0]["minted"], (100 * RULE).to_string());
    let supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(
        supply,
        (100 * RULE).to_string(),
        "supply equals the sum of minted rows"
    );

    // A lock for the next round goes through the real ft_transfer_call.
    let lock = |round: u32, amount: u128| {
        let msg = json!({"lock":{"mode":0,"round_id":round}}).to_string();
        alice
            .call(token.id(), "ft_transfer_call")
            .args_json(json!({"receiver_id":game.id(),"amount":amount.to_string(),"msg":msg}))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
    };
    // Round 0 is already in Investigation: the lock is rejected and the RULE comes back.
    lock(0, 10 * RULE).await?.into_result()?;
    assert_eq!(lock_view(&game, &alice, 0).await?, 0);
    wait_balance(&token, alice.id().as_str(), 100 * RULE).await?;
    // Round 1 accepts it.
    lock(1, 40 * RULE).await?.into_result()?;
    wait_balance(&token, alice.id().as_str(), 60 * RULE).await?;
    assert_eq!(lock_view(&game, &alice, 1).await?, 40 * RULE);
    assert_eq!(balance(&token, game.id().as_str()).await?, 40 * RULE);

    // Unlock needs one yocto. Round 1 never started and its slot lies far in the past in this
    // demo setup (genesis 0), so the lock is released; on a production game it waits a period.
    let no_yocto = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":1}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("needs 1 yocto");
    assert!(format!("{no_yocto:?}").contains("E51"), "{no_yocto:?}");
    alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":1}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    wait_balance(&token, alice.id().as_str(), 100 * RULE).await?;
    assert_eq!(lock_view(&game, &alice, 1).await?, 0);
    let supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(supply, (100 * RULE).to_string());
    Ok(())
}
