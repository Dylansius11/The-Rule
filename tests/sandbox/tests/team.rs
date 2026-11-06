//! Team custody using real local contracts and MOCK OutLayer, not testnet.
mod common;
use common::*;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{Value, json};

#[tokio::test]
async fn team_vault_refunds_failed_verdict_and_unlocks_roster() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, .. } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let captain = worker.dev_create_account().await?;
    let member = worker.dev_create_account().await?;
    for actor in [&captain, &member] {
        actor
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let result = captain
        .call(game.id(), "create_team")
        .args_json(json!({"name":"alpha"}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let id: u32 = result.json()?;
    captain
        .call(game.id(), "invite")
        .args_json(json!({"account":member.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    member
        .call(game.id(), "join_team")
        .args_json(json!({"team_id":id}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    captain
        .call(game.id(), "team_deposit")
        .args_json(json!({"team_id":id}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":1}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    resolve(&mock, 1, begin_value(&"22".repeat(32)), false).await?;
    begin.await?.into_result()?;
    for _ in 0..50 {
        let r: Value = game
            .view("get_round")
            .args_json(json!({"mode":1,"id":0}))
            .await?
            .json()?;
        if r["phase"] == "Investigation" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let play = member
        .call(game.id(), "play")
        .args_json(json!({"mode":1,"number":417,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 3).await?;
    let locked = member
        .call(game.id(), "leave_team")
        .max_gas()
        .transact()
        .await?;
    assert!(locked.into_result().is_err());
    resolve(&mock, 2, Value::Null, false).await?;
    play.await?.into_result()?;
    for _ in 0..50 {
        let t: Value = game
            .view("get_team")
            .args_json(json!({"team_id":id}))
            .await?
            .json()?;
        if t["active_round"].is_null() {
            assert_eq!(
                t["vault"],
                NearToken::from_near(1).as_yoctonear().to_string()
            );
            member
                .call(game.id(), "leave_team")
                .max_gas()
                .transact()
                .await?
                .into_result()?;
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("team verdict refund did not complete".into())
}

#[tokio::test]
async fn team_roster_enforces_five_and_revokes_invites() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { game, .. } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let captain = worker.dev_create_account().await?;
    captain
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let id: u32 = captain
        .call(game.id(), "create_team")
        .args_json(json!({"name":"alpha"}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    let mut members = Vec::new();
    for _ in 0..4 {
        let member = worker.dev_create_account().await?;
        member
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        captain
            .call(game.id(), "invite")
            .args_json(json!({"account":member.id()}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        member
            .call(game.id(), "join_team")
            .args_json(json!({"team_id":id}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        members.push(member);
    }
    let sixth = worker.dev_create_account().await?;
    let rejected = captain
        .call(game.id(), "invite")
        .args_json(json!({"account":sixth.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result();
    assert!(
        format!(
            "{:?}",
            rejected.expect_err("full team must reject invitation")
        )
        .contains("E31")
    );
    captain
        .call(game.id(), "remove_member")
        .args_json(json!({"account":members[3].id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    captain
        .call(game.id(), "invite")
        .args_json(json!({"account":sixth.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    captain
        .call(game.id(), "remove_member")
        .args_json(json!({"account":sixth.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let team: Value = game
        .view("get_team")
        .args_json(json!({"team_id":id}))
        .await?
        .json()?;
    assert_eq!(team["members"].as_array().unwrap().len(), 4);
    assert!(team["invites"].as_array().unwrap().is_empty());
    Ok(())
}

async fn team_terminal_refunds_or_pays(valid_open: bool) -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let (rule, _) = rule_core::sample(b"team-sandbox");
    let round_salt = [5u8; 32];
    let sealed = serde_json::to_value(protocol::round_commitment(&rule, &round_salt))?;
    let Env { mock, game, .. } = start(&worker, sealed.as_str().unwrap(), 3_000_000_000).await?;
    let captain = worker.dev_create_account().await?;
    let member = worker.dev_create_account().await?;
    for actor in [&captain, &member] {
        actor
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let id: u32 = captain
        .call(game.id(), "create_team")
        .args_json(json!({"name":"alpha"}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    captain
        .call(game.id(), "invite")
        .args_json(json!({"account":member.id()}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    member
        .call(game.id(), "join_team")
        .args_json(json!({"team_id":id}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    captain
        .call(game.id(), "team_deposit")
        .args_json(json!({"team_id":id}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    captain
        .call(game.id(), "seed_pot")
        .args_json(json!({"mode":1}))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":1}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    resolve(&mock, 1, begin_value(sealed.as_str().unwrap()), false).await?;
    begin.await?.into_result()?;
    for _ in 0..50 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":1,"id":0}))
            .await?
            .json()?;
        if round["phase"] == "Investigation" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let salt = [9u8; 32];
    let hash = protocol::commit_hash(&protocol::CommitPreimage {
        chain: "testnet",
        game: game.id().as_str(),
        mode: protocol::Mode::Team,
        round: 0,
        actor: captain.id().as_str(),
        entity: protocol::Entity::Team(id),
        guess: &rule,
        salt: &salt,
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
    wait_requests(&mock, 3).await?;
    resolve(&mock, 2, json!({"correct":true}), false).await?;
    reveal.await?.into_result()?;
    for _ in 0..50 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":1,"id":0}))
            .await?
            .json()?;
        if round["phase"] == "Reveal" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let mut opened = false;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        worker.fast_forward(2).await?;
        let result = captain
            .call(game.id(), "finalize")
            .args_json(json!({"mode":1}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?
            .await?;
        if result.into_result().is_ok() {
            opened = true;
            break;
        }
    }
    assert!(opened, "team round did not enter Opening");
    wait_requests(&mock, 4).await?;
    let salt_byte = if valid_open { "05" } else { "06" };
    resolve(
        &mock,
        3,
        json!({"rule":rule,"salt":salt_byte.repeat(32)}),
        false,
    )
    .await?;
    for _ in 0..50 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":1,"id":0}))
            .await?
            .json()?;
        if round["phase"] == if valid_open { "Settled" } else { "Void" } {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let returned: String = captain
        .call(game.id(), "settle_team")
        .args_json(json!({"team_id":id}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert_eq!(returned, "100000000000000000000000");
    for actor in [&captain, &member] {
        let result = actor
            .call(game.id(), "claim_team")
            .args_json(json!({"mode":1,"round_id":0,"team_id":id}))
            .max_gas()
            .transact()
            .await?;
        if valid_open {
            let paid: String = result.json()?;
            assert_eq!(paid, "200000000000000000000000");
        } else {
            assert!(result.into_result().is_err());
        }
    }
    Ok(())
}

#[tokio::test]
async fn team_winner_splits_pot_and_stake_returns_to_vault() -> Res<()> {
    team_terminal_refunds_or_pays(true).await
}

#[tokio::test]
async fn void_round_returns_team_stake_without_paying_winner() -> Res<()> {
    team_terminal_refunds_or_pays(false).await
}
