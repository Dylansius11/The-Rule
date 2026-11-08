//! Mint, lock and unlock on the real game and token wasm with the MOCK OutLayer (never testnet evidence).
mod common;

use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker, network::Sandbox};
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

fn rpc(worker: &Worker<Sandbox>, method: &str, params: Value) -> Res<Value> {
    let body = json!({"jsonrpc":"2.0","id":"mint-burn","method":method,"params":params});
    let output = std::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--max-time",
            "15",
            "--noproxy",
            "*",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
        ])
        .arg(body.to_string())
        .arg(worker.rpc_addr())
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "{method}: {} {}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        )
        .into());
    }
    let response: Value = serde_json::from_slice(&output.stdout)?;
    if let Some(error) = response.get("error") {
        return Err(format!("{method}: {error}").into());
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| format!("{method}: missing result").into())
}

async fn assert_burn_receipts(
    worker: &Worker<Sandbox>,
    tx: &str,
    alice: &Account,
    token: &Contract,
    receiver: &Contract,
) -> Res<u128> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    for _ in 0..100 {
        let status = rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({
                "tx_hash":tx,"sender_account_id":alice.id(),"wait_until":"INCLUDED"
            }),
        )?;
        let mut found = Vec::new();
        if let Some(outcomes) = status["receipts_outcome"].as_array() {
            for outcome in outcomes {
                let id = outcome["id"].as_str().ok_or("missing receipt id")?;
                let receipt = rpc(worker, "EXPERIMENTAL_receipt", json!({"receipt_id":id}))?;
                assert_eq!(receipt["receipt_id"], id);
                assert_eq!(receipt["receiver_id"], outcome["outcome"]["executor_id"]);
                if let Some(actions) = receipt["receipt"]["Action"]["actions"].as_array() {
                    for action in actions {
                        let call = &action["FunctionCall"];
                        if ["ft_transfer_call", "ft_on_transfer", "ft_resolve_transfer"]
                            .iter()
                            .any(|name| call["method_name"] == *name)
                        {
                            let args: Value = serde_json::from_slice(
                                &STANDARD.decode(call["args"].as_str().ok_or("missing args")?)?,
                            )?;
                            found.push((
                                call["method_name"].as_str().unwrap().to_owned(),
                                receipt.clone(),
                                outcome.clone(),
                                args,
                            ));
                        }
                    }
                }
            }
        }
        let Some(transfer) = found.iter().find(|item| item.0 == "ft_transfer_call") else {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            continue;
        };
        let Some(receive) = found.iter().find(|item| item.0 == "ft_on_transfer") else {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            continue;
        };
        let Some(resolver) = found.iter().find(|item| item.0 == "ft_resolve_transfer") else {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            continue;
        };
        assert_eq!(transfer.1["predecessor_id"], alice.id().as_str());
        assert_eq!(transfer.1["receiver_id"], token.id().as_str());
        assert_eq!(receive.1["predecessor_id"], token.id().as_str());
        assert_eq!(receive.1["receiver_id"], receiver.id().as_str());
        assert_eq!(resolver.1["predecessor_id"], token.id().as_str());
        assert_eq!(resolver.1["receiver_id"], token.id().as_str());
        for item in [transfer, receive, resolver] {
            let result = &item.2["outcome"]["status"];
            assert!(
                result.get("SuccessValue").is_some() || result.get("SuccessReceiptId").is_some(),
                "{}: {result}",
                item.0
            );
        }
        let children = transfer.2["outcome"]["receipt_ids"]
            .as_array()
            .ok_or("missing transfer children")?;
        assert!(children.contains(&receive.2["id"]));
        assert!(children.contains(&resolver.2["id"]));
        let dependencies = resolver.1["receipt"]["Action"]["input_data_ids"]
            .as_array()
            .ok_or("missing resolver dependency")?;
        let outputs = receive.1["receipt"]["Action"]["output_data_receivers"]
            .as_array()
            .ok_or("missing receiver output")?;
        assert!(
            outputs
                .iter()
                .any(|output| output["receiver_id"] == token.id().as_str()
                    && dependencies.contains(&output["data_id"]))
        );
        assert_eq!(receive.3["sender_id"], alice.id().as_str());
        assert_eq!(receive.3["amount"], (100 * RULE).to_string());
        assert_eq!(resolver.3["sender_id"], alice.id().as_str());
        assert_eq!(resolver.3["receiver_id"], receiver.id().as_str());
        assert_eq!(resolver.3["amount"], (100 * RULE).to_string());
        let logs = resolver.2["outcome"]["logs"]
            .as_array()
            .ok_or("missing resolver logs")?;
        let events: Vec<Value> = logs
            .iter()
            .filter_map(|line| line.as_str()?.strip_prefix("EVENT_JSON:"))
            .filter_map(|event| serde_json::from_str(event).ok())
            .collect();
        let burns: Vec<&Value> = events
            .iter()
            .filter(|event| event["standard"] == "nep141" && event["event"] == "ft_burn")
            .collect();
        assert_eq!(burns.len(), 1);
        let data = burns[0]["data"].as_array().ok_or("missing burn data")?;
        assert_eq!(data.len(), 1);
        assert_eq!(data[0]["owner_id"], receiver.id().as_str());
        return Ok(data[0]["amount"]
            .as_str()
            .ok_or("missing burn amount")?
            .parse()?);
    }
    Err(format!("missing transfer, receiver or resolver receipt for {tx}").into())
}

#[tokio::test]
async fn accept_mints_real_rule_and_a_lock_round_trips_through_the_token() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, token } =
        start_with_period(&worker, &"11".repeat(32), WINDOW_NS, 120_000_000_000).await?;
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

    // The never-started slot releases only after its full scheduled period.
    // Advance the real sandbox clock, not game state or callback ownership.
    let timing: Value = game.view("get_params").await?.json()?;
    let deadline = timing["genesis_ns"].as_u64().ok_or("missing genesis")?
        + 2 * timing["round_period_ns"].as_u64().ok_or("missing period")?;
    let stop = std::time::Instant::now() + std::time::Duration::from_secs(90);
    while worker.view_block().await?.timestamp() < deadline {
        assert!(
            std::time::Instant::now() < stop,
            "sandbox lock deadline not reached"
        );
        worker.fast_forward(100).await?;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
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

#[tokio::test]
async fn resolver_burn_preserves_game_log_supply_invariant() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let Env { mock, game, token } = start(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let min: u128 = bounds["min"]
        .as_str()
        .ok_or("missing storage minimum")?
        .parse()?;
    let alice = worker.dev_create_account().await?;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    for account in [alice.id(), mock.id()] {
        token
            .call("storage_deposit")
            .args_json(json!({"account_id":account,"registration_only":true}))
            .deposit(NearToken::from_yoctonear(min))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    wait_token_state(&game, &alice, "registered").await?;
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
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["minted"], (100 * RULE).to_string());
    let round: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    let allowance = round["allowance_left"].clone();
    let supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(supply, (100 * RULE).to_string());

    let transfer = alice.call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":mock.id(),"amount":(100 * RULE).to_string(),"msg":"delayed-refund"}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(300)).transact_async().await?;
    wait_requests(&mock, 3).await?;
    let request: (String, Option<String>) = mock
        .view("get_request")
        .args_json(json!({"id":2}))
        .await?
        .json()?;
    assert_eq!(request.0, token.id().as_str());
    let input: Value = serde_json::from_str(request.1.as_deref().ok_or("missing receiver input")?)?;
    assert_eq!(
        input,
        json!({"sender_id":alice.id(),"amount":(100 * RULE).to_string(),"msg":"delayed-refund"})
    );
    assert_eq!(balance(&token, alice.id().as_str()).await?, 0);
    assert_eq!(balance(&token, mock.id().as_str()).await?, 100 * RULE);
    let removed: bool = alice
        .call(token.id(), "storage_unregister")
        .args_json(json!({"force":false}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert!(removed);
    let registration: Option<Value> = token
        .view("storage_balance_of")
        .args_json(json!({"account_id":alice.id()}))
        .await?
        .json()?;
    assert!(registration.is_none());
    let resumed: bool = mock
        .call("resolve")
        .args_json(json!({"id":2,"resolution":{"value":(40 * RULE).to_string(),"error":false}}))
        .max_gas()
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert!(resumed);
    let result = transfer.await?;
    let tx = result.outcome().transaction_hash.to_string();
    result.into_result()?;
    let burned = assert_burn_receipts(&worker, &tx, &alice, &token, &mock).await?;
    assert_eq!(burned, 40 * RULE);
    assert_eq!(balance(&token, mock.id().as_str()).await?, 60 * RULE);
    let supply: String = token.view("ft_total_supply").await?.json()?;
    let supply: u128 = supply.parse()?;
    assert_eq!(supply, 60 * RULE);
    assert_eq!(
        supply,
        rows[0]["minted"]
            .as_str()
            .ok_or("missing minted")?
            .parse::<u128>()?
            - burned
    );
    let after: Vec<Value> = game
        .view("get_log")
        .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
        .await?
        .json()?;
    assert_eq!(after, rows);
    let round: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    assert_eq!(round["allowance_left"], allowance);
    let duplicate: bool = mock
        .call("resolve")
        .args_json(json!({"id":2,"resolution":{"value":(40 * RULE).to_string(),"error":false}}))
        .max_gas()
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert!(!duplicate);
    let final_supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(final_supply, supply.to_string());
    Ok(())
}
