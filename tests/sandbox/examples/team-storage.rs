//! Max-roster storage and settlement on actual local WASM with MOCK OutLayer.
#[path = "../tests/common/mod.rs"]
mod common;
use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use protocol::{CommitPreimage, Entity, Mode, RuleHex};
use serde_json::{Value, json};
use std::time::Duration;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const BYTE: u128 = 10_000_000_000_000_000_000;
const ACTION: u128 = 2048 * BYTE;
const STAKE: u128 = NEAR / 10;

fn amount(v: &Value, key: &str) -> u128 {
    v[key].as_str().unwrap().parse().unwrap()
}
async fn team(game: &Contract, id: u32) -> Res<Value> {
    Ok(game
        .view("get_team")
        .args_json(json!({"team_id":id}))
        .await?
        .json()?)
}
async fn round(game: &Contract) -> Res<Value> {
    Ok(game
        .view("get_round")
        .args_json(json!({"mode":1,"id":0}))
        .await?
        .json()?)
}
async fn phase(game: &Contract, expected: &str) -> Res<()> {
    for _ in 0..50 {
        if round(game).await?["phase"] == expected {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("Team never reached {expected}").into())
}
async fn vault(game: &Contract, id: u32, expected: u128) -> Res<()> {
    for _ in 0..50 {
        if amount(&team(game, id).await?, "vault") == expected {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err("Team vault did not reach expected amount".into())
}
async fn call(
    actor: &Account,
    game: &Contract,
    method: &str,
    args: Value,
) -> Res<near_workspaces::result::ExecutionFinalResult> {
    let result = actor
        .call(game.id(), method)
        .args_json(args)
        .max_gas()
        .transact()
        .await?;
    if !result.is_success() {
        return Err(format!("{method} failed: {result:?}").into());
    }
    Ok(result)
}
async fn usage(game: &Contract) -> Res<u64> {
    Ok(game.view_account().await?.storage_usage)
}
fn funded(label: &str, before: u64, after: u64, charge: u128) {
    let growth = after.saturating_sub(before);
    println!("TEAM STORAGE {label}: growth={growth} bytes, charge={charge} yocto");
    assert!(u128::from(growth) * BYTE <= charge, "{label} underfunded");
}

#[tokio::main]
async fn main() -> Res<()> {
    println!(
        "LOCAL TEAM: five 64-character actors, actual game/token WASM, MOCK OutLayer; not testnet"
    );
    let worker = near_workspaces::sandbox().await?;
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
    token.call("new").args_json(json!({"minter":game.id(),"cap":(100_000_000u128 * NEAR).to_string(),"metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}})).transact().await?.into_result()?;
    fund_token_operations(&token).await?;
    let mut config = sandbox_tests::params(mock.id().as_str());
    config["token"] = json!(token.id());
    config["storage_charge_account"] = json!((512 * BYTE).to_string());
    config["storage_charge_per_play"] = json!(ACTION.to_string());
    config["storage_charge_team"] = json!(ACTION.to_string());
    config["reveal_window_ns"] = json!(1_000_000_000u64);
    let url = format!("https://example.com/{}", "x".repeat(2028));
    config["referee"]["urls"] = json!([url, url]);
    config["lock_tiers"] = json!([
        {"amount":"1","extra_attempts":1}, {"amount":"2","extra_attempts":2}, {"amount":"3","extra_attempts":3}
    ]);
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    let root = worker.root_account()?;
    let name_len = 64 - root.id().as_str().len() - 1;
    let mut actors = Vec::new();
    for i in 0..5 {
        let prefix = format!("team{i}");
        let actor = root
            .create_subaccount(&format!("{prefix}{}", "x".repeat(name_len - prefix.len())))
            .initial_balance(NearToken::from_near(10))
            .transact()
            .await?
            .into_result()?;
        assert_eq!(actor.id().as_str().len(), 64);
        let before = usage(&game).await?;
        actor
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        funded("account", before, usage(&game).await?, 512 * BYTE);
        actors.push(actor);
    }
    let before_team = usage(&game).await?;
    let id: u32 = call(
        &actors[0],
        &game,
        "create_team",
        json!({"name":"x".repeat(24)}),
    )
    .await?
    .json()?;
    for actor in &actors[1..] {
        call(&actors[0], &game, "invite", json!({"account":actor.id()}))
            .await?
            .into_result()?;
        call(actor, &game, "join_team", json!({"team_id":id}))
            .await?
            .into_result()?;
    }
    let mut deposits = Vec::new();
    for (i, actor) in actors.iter().enumerate() {
        let deposit = (i as u128 + 1) * NEAR / 10;
        actor
            .call(game.id(), "team_deposit")
            .args_json(json!({"team_id":id}))
            .deposit(NearToken::from_yoctonear(deposit))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        deposits.push(deposit);
    }
    let deposited: u128 = deposits.iter().sum();
    assert_eq!(amount(&team(&game, id).await?, "vault"), deposited);
    funded(
        "five-member team, memberships and five depositors",
        before_team,
        usage(&game).await?,
        ACTION,
    );
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let storage = amount(&bounds, "min");
    actors[4]
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":actors[4].id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(storage))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    call(&actors[4], &game, "register_token", json!({}))
        .await?
        .into_result()?;
    for _ in 0..50 {
        let status: String = game
            .view("get_token_state")
            .args_json(json!({"account":actors[4].id()}))
            .await?
            .json()?;
        if status == "registered" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let rule = rule_core::CanonicalRule::new(
        rule_core::Form::Single,
        vec![rule_core::Literal {
            atom: rule_core::Atom::new(0).unwrap(),
            negated: false,
        }],
    )
    .unwrap();
    let commitment = serde_json::to_value(protocol::round_commitment(&rule, &[5; 32]))?;
    game.call("seed_pot")
        .args_json(json!({"mode":1}))
        .deposit(NearToken::from_yoctonear(7))
        .transact()
        .await?
        .into_result()?;
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":1}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 1).await?;
    resolve(&mock, 0, begin_value(commitment.as_str().unwrap()), false).await?;
    begin.await?.into_result()?;
    phase(&game, "Investigation").await?;
    // A fully refunded first attempt releases the provisional roster snapshot.
    let first = actors[4]
        .call(game.id(), "play")
        .args_json(json!({"mode":1,"number":999,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    let failed_leave = actors[0]
        .call(game.id(), "leave_team")
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("pending roster must be locked");
    assert!(format!("{failed_leave:?}").contains("E30"));
    resolve(&mock, 1, Value::Null, false).await?;
    first.await?.into_result()?;
    vault(&game, id, deposited).await?;
    assert!(team(&game, id).await?["active_round"].is_null());
    let before_play = usage(&game).await?;
    for (request, number, verdict) in [(2u32, 998u16, 1u8), (3, 997, 0)] {
        let play = actors[4]
            .call(game.id(), "play")
            .args_json(json!({"mode":1,"number":number,"word":"otter"}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, request + 1).await?;
        resolve(&mock, request, json!({"v":verdict}), false).await?;
        play.await?.into_result()?;
        vault(
            &game,
            id,
            deposited - u128::from(request - 1) * (NEAR / 100 + ACTION),
        )
        .await?;
    }
    // Observe the separate mint callback rather than infer it from the verdict.
    let mut minted = false;
    for _ in 0..50 {
        let supply: String = token.view("ft_total_supply").await?.json()?;
        if supply.parse::<u128>()? == 100 * 1_000_000_000_000_000_000 {
            minted = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(
        minted,
        "actual Team YES did not mint to its registered actor"
    );
    funded(
        "two plays including five-member snapshot and actual mint",
        before_play,
        usage(&game).await?,
        2 * ACTION,
    );
    let hash = protocol::commit_hash(&CommitPreimage {
        chain: "testnet",
        game: game.id().as_str(),
        mode: Mode::Team,
        round: 0,
        actor: actors[4].id().as_str(),
        entity: Entity::Team(id),
        guess: &rule,
        salt: &[9; 32],
    });
    let ack = call(
        &actors[4],
        &game,
        "commit_guess",
        json!({"mode":1,"hash":hash}),
    )
    .await?
    .json::<Value>()?;
    assert_eq!(amount(&ack, "stake"), STAKE);
    worker.fast_forward(5).await?;
    let reveal = actors[4].call(game.id(),"reveal_guess").args_json(json!({"mode":1,"commit_seq":0,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":"09".repeat(32)})).gas(Gas::from_tgas(300)).transact_async().await?;
    wait_requests(&mock, 5).await?;
    resolve(&mock, 4, json!({"correct":true}), false).await?;
    reveal.await?.into_result()?;
    phase(&game, "Reveal").await?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let open = game
        .call("finalize")
        .args_json(json!({"mode":1}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 6).await?;
    resolve(&mock, 5, json!({"rule":rule,"salt":"05".repeat(32)}), false).await?;
    open.await?.into_result()?;
    phase(&game, "Settled").await?;
    let pot = 7 + 2 * NEAR / 100 * 8000 / 10000;
    let winner = pot * 4000 / 10000;
    let contributor = pot * 4000 / 10000 / 2 * 2;
    let each = winner / 5 + contributor / 5;
    let platform = pot * 1000 / 10000;
    let carry = pot - 5 * each - platform;
    let ledger: Value = game.view("get_ledger").await?.json()?;
    assert_eq!(amount(&ledger, "claimable"), 5 * each);
    assert_eq!(amount(&ledger, "carry"), carry);
    assert_eq!(
        amount(&ledger, "platform_accrued"),
        2 * NEAR / 100 * 500 / 10000 + platform
    );
    assert_eq!(amount(&ledger, "open_stakes"), STAKE);
    let returned = call(&actors[0], &game, "settle_team", json!({"team_id":id})).await?;
    assert_eq!(returned.json::<String>()?.parse::<u128>()?, STAKE);
    let mut remaining_vault = deposited - 2 * (NEAR / 100 + ACTION) - ACTION;
    vault(&game, id, remaining_vault).await?;
    let prior_team = team(&game, id).await?;
    let rejected = actors[4]
        .call(game.id(), "team_deposit")
        .args_json(json!({"team_id":id}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("new capital must not absorb old losses");
    assert!(format!("{rejected:?}").contains("E30"));
    assert_eq!(team(&game, id).await?, prior_team);
    // Every input weight is an exact multiple of 0.1 NEAR; cancel that common
    // factor in the independent oracle before multiplication to avoid u128 overflow.
    let mut weight = deposited / (NEAR / 10);
    for (i, actor) in actors.iter().enumerate() {
        let before = credit(&game, actor).await?;
        let units = deposits[i] / (NEAR / 10);
        let expected = remaining_vault * units / weight;
        call(actor, &game, "leave_team", json!({}))
            .await?
            .into_result()?;
        assert_eq!(credit(&game, actor).await? - before, expected);
        remaining_vault -= expected;
        weight -= units;
    }
    assert_eq!(remaining_vault, 0);
    assert_eq!(weight, 0);
    for actor in &actors {
        let before = credit(&game, actor).await?;
        let claimed = call(
            actor,
            &game,
            "claim_team",
            json!({"mode":1,"round_id":0,"team_id":id}),
        )
        .await?;
        assert_eq!(claimed.json::<String>()?.parse::<u128>()?, each);
        assert_eq!(credit(&game, actor).await? - before, each);
    }
    let duplicate = actors[0]
        .call(game.id(), "claim_team")
        .args_json(json!({"mode":1,"round_id":0,"team_id":id}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("duplicate Team claim");
    assert!(format!("{duplicate:?}").contains("E56"));
    let ledger: Value = game.view("get_ledger").await?.json()?;
    assert_eq!(amount(&ledger, "claimable"), 0);
    assert_eq!(amount(&ledger, "open_stakes"), 0);
    assert_eq!(amount(&ledger, "vault"), 0);
    println!(
        "TEAM PASS: five max-length members, funded records, full failed-play refund, shared line, actual YES mint, correct stake, exact splits/dust, pro-rata exit and historical claims after roster deletion; pot={pot}, each={each}, carry={carry}"
    );
    Ok(())
}
