//! Local sandbox gas report with a MOCK OutLayer, not testnet evidence.
//! Run after building sandbox artifacts: `cargo run -p sandbox-tests --profile fast --example gas`.
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use protocol::RuleHex;
use serde_json::{Value, json};
use std::time::Duration;

const TGAS: u64 = 1_000_000_000_000;

// The workspaces receipt/status helpers require its disabled `experimental` feature.
// Query this sandbox's own RPC directly without changing workspace dependencies.
fn rpc(worker: &Worker<Sandbox>, method: &str, params: Value) -> Res<Value> {
    let body = json!({"jsonrpc":"2.0","id":"gas","method":method,"params":params});
    let output = std::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--fail",
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
        .output()
        .map_err(|error| format!("cannot run curl for sandbox {method}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "sandbox {method} transport failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    let response: Value = serde_json::from_slice(&output.stdout)?;
    if let Some(error) = response.get("error") {
        return Err(format!("sandbox {method} RPC failed: {error}").into());
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| format!("sandbox {method} response missing result").into())
}

fn request(label: &str, result: &ExecutionFinalResult) -> Res<String> {
    if !result.is_success() {
        return Err(format!("{label}: initiating transaction failed: {result:?}").into());
    }
    let hash = result.outcome().transaction_hash.to_string();
    println!(
        "REQUEST {label}: tx={hash} reported_burnt={} gas (may exclude delayed receipts)",
        result.total_gas_burnt.as_gas()
    );
    Ok(hash)
}

// Re-query after resumption: the initiating transaction can complete before detached
// callbacks. Match each execution outcome to its actual receipt action.
async fn callbacks(
    worker: &Worker<Sandbox>,
    tx: &str,
    sender: &str,
    game: &Contract,
    token: &Contract,
    methods: &[&str],
) -> Res<()> {
    for _ in 0..100 {
        let value = rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({
                "tx_hash":tx, "sender_account_id":sender, "wait_until":"INCLUDED"
            }),
        )?;
        let Some(outcomes) = value["receipts_outcome"].as_array() else {
            tokio::time::sleep(Duration::from_millis(200)).await;
            continue;
        };
        let mut found = Vec::new();
        for outcome in outcomes {
            if outcome["outcome"]["executor_id"] != game.id().as_str()
                && outcome["outcome"]["executor_id"] != token.id().as_str()
            {
                continue;
            }
            let Some(id) = outcome["id"].as_str() else {
                continue;
            };
            let receipt = rpc(worker, "EXPERIMENTAL_receipt", json!({"receipt_id":id}))?;
            if receipt["receiver_id"] != outcome["outcome"]["executor_id"]
                || receipt["receipt_id"] != id
            {
                return Err(format!("receipt identity mismatch for {id}").into());
            }
            let Some(actions) = receipt["receipt"]["Action"]["actions"].as_array() else {
                continue;
            };
            for action in actions {
                let call = &action["FunctionCall"];
                let Some(method) = call["method_name"].as_str() else {
                    continue;
                };
                let expected_receiver = if method == "mint" {
                    token.id().as_str()
                } else {
                    game.id().as_str()
                };
                if receipt["receiver_id"] != expected_receiver
                    || receipt["predecessor_id"] != game.id().as_str()
                {
                    continue;
                }
                if !methods.contains(&method) {
                    continue;
                }
                let status = &outcome["outcome"]["status"];
                let success = status.get("SuccessValue").is_some()
                    || status.get("SuccessReceiptId").is_some();
                let expected_success = !(method == "mint" && methods.contains(&"mint_failure"));
                if success != expected_success {
                    return Err(format!("unexpected {method} receipt {id} status: {status}").into());
                }
                if !success
                    && (status.get("Failure").is_none() || !status.to_string().contains("E52"))
                {
                    return Err(format!("mint failed for an unexpected reason: {status}").into());
                }
                let allocated = call["gas"].as_u64().ok_or("missing action gas")?;
                let burnt = outcome["outcome"]["gas_burnt"]
                    .as_u64()
                    .ok_or("missing burnt gas")?;
                let budget = if method == "mint" || method == "on_mint" {
                    10
                } else {
                    60
                } * TGAS;
                assert_eq!(allocated, budget, "{method} allocation");
                assert!(burnt <= allocated, "{method} exceeded its allocation");
                found.push((
                    method.to_owned(),
                    id.to_owned(),
                    call["gas"].clone(),
                    outcome["outcome"].clone(),
                ));
            }
        }
        if methods
            .iter()
            .filter(|method| **method != "mint_failure")
            .all(|method| found.iter().any(|(m, _, _, _)| m == method))
        {
            for (method, id, allocated, outcome) in found {
                println!(
                    "ACTION {method}: receipt={id} tx={tx} receiver={} predecessor={} status={} prepaid_action_gas={allocated} burnt_gas={} outgoing_receipt_ids={} logs={}",
                    outcome["executor_id"],
                    game.id(),
                    outcome["status"],
                    outcome["gas_burnt"],
                    outcome["receipt_ids"],
                    outcome["logs"]
                );
                if method == "on_verdict" && methods.contains(&"on_mint") {
                    println!(
                        "MINT BUDGET: callback prepaid above; mint and on_mint actions are separately allocated (configured 10 Tgas each); guard requires 25 Tgas remaining at its check. Exact remaining gas at that point is not exposed by this receipt; burnt gas is not the remaining budget."
                    );
                }
            }
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("receipt tracing unavailable or expected callbacks {methods:?} missing from tx {tx}; no callback gas inferred").into())
}

async fn trace(
    worker: &Worker<Sandbox>,
    label: &str,
    result: ExecutionFinalResult,
    sender: &str,
    game: &Contract,
    token: &Contract,
    methods: &[&str],
) -> Res<()> {
    let tx = request(label, &result)?;
    callbacks(worker, &tx, sender, game, token, methods).await
}

async fn resolve_checked(mock: &Contract, id: u32, value: Value, error: bool) -> Res<()> {
    let resumed: bool = mock
        .call("resolve")
        .args_json(json!({"id":id,"resolution":{"value":value,"error":error}}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    if !resumed {
        return Err(format!("mock yield {id} was not resumed").into());
    }
    Ok(())
}

async fn round(game: &Contract) -> Res<Value> {
    Ok(game
        .view("get_round")
        .args_json(json!({"mode":0,"id":null}))
        .await?
        .json()?)
}

async fn withdraw_during_check(alice: &Account, game: &Contract) -> Res<()> {
    let before = credit(game, alice).await?;
    let result = alice
        .call(game.id(), "withdraw_credit")
        .args_json(json!({"amount":"1"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    let failure = result
        .into_result()
        .expect_err("withdrawal while Checking must fail");
    assert!(format!("{failure:?}").contains("E21"), "{failure:?}");
    assert_eq!(
        credit(game, alice).await?,
        before,
        "Checking withdrawal changed credit"
    );
    Ok(())
}

// Unlike callbacks, the initiating action is sent by the external signer.
async fn finalize_action(
    worker: &Worker<Sandbox>,
    tx: &str,
    sender: &str,
    game: &Contract,
) -> Res<()> {
    for _ in 0..100 {
        let value = rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({
                "tx_hash":tx, "sender_account_id":sender, "wait_until":"INCLUDED"
            }),
        )?;
        if let Some(outcomes) = value["receipts_outcome"].as_array() {
            for outcome in outcomes {
                let Some(id) = outcome["id"].as_str() else {
                    continue;
                };
                if outcome["outcome"]["executor_id"] != game.id().as_str() {
                    continue;
                }
                let receipt = rpc(worker, "EXPERIMENTAL_receipt", json!({"receipt_id":id}))?;
                if receipt["receipt_id"] != id || receipt["receiver_id"] != game.id().as_str() {
                    return Err(format!("receipt identity mismatch for {id}").into());
                }
                if receipt["predecessor_id"] != sender {
                    continue;
                }
                let Some(actions) = receipt["receipt"]["Action"]["actions"].as_array() else {
                    continue;
                };
                for action in actions {
                    let call = &action["FunctionCall"];
                    if call["method_name"] != "finalize" {
                        continue;
                    }
                    let allocated = call["gas"].as_u64().ok_or("missing finalize gas")?;
                    let burnt = outcome["outcome"]["gas_burnt"]
                        .as_u64()
                        .ok_or("missing finalize burnt gas")?;
                    let status = &outcome["outcome"]["status"];
                    assert!(
                        status.get("SuccessValue").is_some()
                            || status.get("SuccessReceiptId").is_some(),
                        "finalize {id}: {status}"
                    );
                    assert_eq!(allocated, 300 * TGAS);
                    assert!(burnt <= allocated);
                    println!(
                        "ACTION finalize: receipt={id} tx={tx} sender={sender} receiver={} status={status} prepaid_action_gas={allocated} burnt_gas={burnt} outgoing_receipt_ids={} logs={}",
                        game.id(),
                        outcome["outcome"]["receipt_ids"],
                        outcome["outcome"]["logs"]
                    );
                    return Ok(());
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("finalize action missing from tx {tx}").into())
}

fn amount(value: &Value, field: &str) -> Res<u128> {
    Ok(value[field]
        .as_str()
        .ok_or_else(|| format!("missing {field}"))?
        .parse()?)
}

async fn ledger(game: &Contract) -> Res<Value> {
    Ok(game.view("get_ledger").await?.json()?)
}

// Separate deployments preserve the short remainder case and exercise a full final
// batch. Each losing actor holds at most three commits; all account ids are 64 bytes.
async fn sweep_fixture(
    worker: &Worker<Sandbox>,
    rule: &rule_core::CanonicalRule,
    unrevealed: usize,
    winner_seq: usize,
) -> Res<()> {
    const STAKE: u128 = 100_000_000_000_000_000_000_000;
    const RETURNED: u128 = STAKE / 2;
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
    token.call("new").args_json(json!({"minter":game.id(),"cap":"1000000000000000000000000000","metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}})).transact().await?.into_result()?;
    let mut config = sandbox_tests::params(mock.id().as_str());
    config["reveal_window_ns"] = json!(3_000_000_000u64);
    config["token"] = json!(token.id());
    game.call("new")
        .args_json(json!({"params":config,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    // One yocto makes split rounding dust observable without changing the stake minimum.
    game.call("seed_pot")
        .args_json(json!({"mode":0}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let commitment = serde_json::to_value(protocol::round_commitment(rule, &[5u8; 32]))?;
    let begin = game
        .call("start_round")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 1).await?;
    resolve_checked(
        &mock,
        0,
        begin_value(commitment.as_str().ok_or("missing commitment")?),
        false,
    )
    .await?;
    tokio::time::timeout(Duration::from_secs(30), begin)
        .await??
        .into_result()?;
    for _ in 0..100 {
        if round(&game).await?["phase"] == "Investigation" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert_eq!(round(&game).await?["phase"], "Investigation");

    let root = worker.root_account()?;
    let name_len = 64 - root.id().as_str().len() - 1;
    let mut actors = Vec::new();
    let losing_actors = unrevealed.div_ceil(3);
    for i in 0..=losing_actors {
        let prefix = format!("sweep{unrevealed}-{i}");
        let name = format!("{prefix}{}", "x".repeat(name_len - prefix.len()));
        let actor = root
            .create_subaccount(&name)
            .initial_balance(NearToken::from_near(10))
            .transact()
            .await?
            .into_result()?;
        assert_eq!(actor.id().as_str().len(), 64);
        actor
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        actors.push(actor);
    }
    let storage = amount(&config, "storage_charge_per_play")?;
    let winner = &actors[losing_actors];
    let player: Value = game
        .view("get_player")
        .args_json(json!({"account":winner.id()}))
        .await?
        .json()?;
    let index = u32::try_from(player["index"].as_u64().ok_or("missing winner index")?)?;
    let hash = serde_json::to_value(protocol::commit_hash(&protocol::CommitPreimage {
        chain: "testnet",
        game: game.id().as_str(),
        mode: protocol::Mode::Solo,
        round: 0,
        actor: winner.id().as_str(),
        entity: protocol::Entity::Solo(index),
        guess: rule,
        salt: &[9u8; 32],
    }))?;
    let mut initial_credits = Vec::new();
    for actor in &actors {
        initial_credits.push(credit(&game, actor).await?);
    }
    let mut owners = Vec::new();
    for seq in 0..=unrevealed {
        let owner = if seq == winner_seq {
            losing_actors
        } else {
            (seq - usize::from(seq > winner_seq)) / 3
        };
        let ack: Value = actors[owner]
            .call(game.id(), "commit_guess")
            .args_json(json!({
                "mode":0,
                "hash":if seq == winner_seq { hash.clone() } else { json!("00".repeat(32)) }
            }))
            .max_gas()
            .transact()
            .await?
            .json()?;
        assert_eq!(ack["commit_seq"], seq);
        assert_eq!(amount(&ack, "stake")?, STAKE);
        owners.push(owner);
    }
    for (i, actor) in actors.iter().enumerate() {
        let count = owners.iter().filter(|&&owner| owner == i).count() as u128;
        assert_eq!(
            initial_credits[i] - credit(&game, actor).await?,
            count * (STAKE + storage)
        );
    }
    worker.fast_forward(5).await?;
    let reveal = winner.call(game.id(), "reveal_guess").args_json(json!({"mode":0,"commit_seq":winner_seq,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":"09".repeat(32)})).gas(Gas::from_tgas(300)).transact_async().await?;
    wait_requests(&mock, 2).await?;
    resolve_checked(&mock, 1, json!({"correct":true}), false).await?;
    tokio::time::timeout(Duration::from_secs(30), reveal)
        .await??
        .into_result()?;
    wait_status(&game, winner_seq, "Correct").await?;
    let mut before_credits = Vec::new();
    for actor in &actors {
        before_credits.push(credit(&game, actor).await?);
    }
    let before = ledger(&game).await?;
    assert_eq!(
        amount(&before, "open_stakes")?,
        (unrevealed as u128 + 1) * STAKE
    );
    assert_eq!(amount(&before, "round_pots")?, 1);
    let deadline = round(&game).await?["reveal_deadline_ns"]
        .as_u64()
        .ok_or("missing reveal deadline")?;
    let mut reached = false;
    for _ in 0..100 {
        if rpc(worker, "block", json!({"finality":"final"}))?["header"]["timestamp"]
            .as_u64()
            .ok_or("missing block timestamp")?
            >= deadline
        {
            reached = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if !reached {
        return Err("sweep fixture reveal deadline not reached".into());
    }

    let first = winner
        .call(game.id(), "finalize")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    let tx = request(&format!("sweep {unrevealed}: first 20 records"), &first)?;
    finalize_action(worker, &tx, winner.id().as_str(), &game).await?;
    let result: Option<u64> = first.json()?;
    assert_eq!(result, None);
    let rows = commits(&game).await?;
    assert_eq!(rows.len(), unrevealed + 1);
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(amount(row, "stake")?, STAKE);
        assert_eq!(row["actor"], actors[owners[i]].id().as_str());
        assert_eq!(
            row["status"],
            if i == winner_seq {
                "Correct"
            } else if i < 20 {
                "Unrevealed"
            } else {
                "Committed"
            }
        );
    }
    assert_eq!(round(&game).await?["phase"], "Reveal");
    let count: String = mock.view("request_count").await?.json()?;
    assert_eq!(count, "2", "first batch must not request open");
    let after_first = ledger(&game).await?;
    let first_swept = 20 - u128::from(winner_seq < 20);
    let remaining = unrevealed as u128 - first_swept;
    assert_eq!(
        amount(&after_first, "open_stakes")?,
        (remaining + 1) * STAKE
    );
    assert_eq!(
        amount(&after_first, "round_pots")?,
        1 + first_swept * RETURNED
    );
    assert_eq!(
        amount(&after_first, "credit")? - amount(&before, "credit")?,
        first_swept * RETURNED
    );
    for (i, actor) in actors.iter().enumerate() {
        let swept = owners[..20]
            .iter()
            .filter(|&&owner| owner == i && owner != losing_actors)
            .count() as u128;
        assert_eq!(
            credit(&game, actor).await? - before_credits[i],
            swept * RETURNED
        );
    }
    assert_eq!(
        amount(&before, "credit")?
            + amount(&before, "open_stakes")?
            + amount(&before, "round_pots")?,
        amount(&after_first, "credit")?
            + amount(&after_first, "open_stakes")?
            + amount(&after_first, "round_pots")?
    );

    let second = winner
        .call(game.id(), "finalize")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 3).await?;
    let opening = round(&game).await?;
    assert_eq!(opening["phase"], "Opening");
    let pending = ledger(&game).await?;
    assert_eq!(amount(&pending, "open_stakes")?, STAKE);
    assert_eq!(
        amount(&pending, "round_pots")?,
        1 + unrevealed as u128 * RETURNED
    );
    assert_eq!(
        amount(&pending, "credit")? - amount(&after_first, "credit")?,
        remaining * RETURNED
    );
    assert_eq!(
        amount(&after_first, "credit")?
            + amount(&after_first, "open_stakes")?
            + amount(&after_first, "round_pots")?,
        amount(&pending, "credit")?
            + amount(&pending, "open_stakes")?
            + amount(&pending, "round_pots")?
    );
    for (i, actor) in actors.iter().enumerate() {
        assert_eq!(
            credit(&game, actor).await? - before_credits[i],
            owners
                .iter()
                .filter(|&&owner| owner == i && owner != losing_actors)
                .count() as u128
                * RETURNED
        );
    }
    let rows = commits(&game).await?;
    assert_eq!(rows.len(), unrevealed + 1);
    for (seq, row) in rows.iter().enumerate() {
        assert_eq!(
            row["status"],
            if seq == winner_seq {
                "Correct"
            } else {
                "Unrevealed"
            }
        );
    }
    let open_request: Value = mock
        .view("get_request")
        .args_json(json!({"id":2}))
        .await?
        .json()?;
    assert_eq!(open_request[0], game.id().as_str());
    let open_input: Value =
        serde_json::from_str(open_request[1].as_str().ok_or("missing open input")?)?;
    assert_eq!(open_input["op"], "open");
    resolve_checked(
        &mock,
        2,
        json!({"rule":serde_json::to_value(rule)?,"salt":"05".repeat(32)}),
        false,
    )
    .await?;
    let second = tokio::time::timeout(Duration::from_secs(30), second).await??;
    let tx = request(
        &format!("sweep {unrevealed}: final {remaining} unrevealed and open"),
        &second,
    )?;
    finalize_action(worker, &tx, winner.id().as_str(), &game).await?;
    let result: Option<u64> = second.json()?;
    assert_eq!(result, Some(2));
    callbacks(
        worker,
        &tx,
        winner.id().as_str(),
        &game,
        &token,
        &["on_open"],
    )
    .await?;
    let count: String = mock.view("request_count").await?.json()?;
    assert_eq!(count, "3", "exactly one open request");
    let settled = round(&game).await?;
    assert_eq!(settled["phase"], "Settled");
    assert_eq!(settled["outcome"]["account"], winner.id().as_str());
    assert_eq!(settled["rule"], serde_json::to_value(rule)?);
    let pot = 1 + unrevealed as u128 * RETURNED;
    let winner_payout = pot * 4000 / 10000;
    let platform = pot * 1000 / 10000;
    let base_rollover = pot * 1000 / 10000 + pot * 4000 / 10000;
    let dust = pot - winner_payout - platform - base_rollover;
    assert_eq!(dust, 1);
    let final_ledger = ledger(&game).await?;
    assert_eq!(amount(&final_ledger, "round_pots")?, 0);
    assert_eq!(amount(&final_ledger, "open_stakes")?, STAKE);
    assert_eq!(amount(&final_ledger, "claimable")?, winner_payout);
    assert_eq!(amount(&final_ledger, "platform_accrued")?, platform);
    assert_eq!(amount(&final_ledger, "carry")?, base_rollover + dust);
    assert_eq!(winner_payout + platform + base_rollover + dust, pot);
    let claimable: String = game
        .view("get_claimable")
        .args_json(json!({"mode":0,"round_id":0,"account":winner.id()}))
        .await?
        .json()?;
    assert_eq!(claimable.parse::<u128>()?, winner_payout + STAKE);
    for actor in &actors[..losing_actors] {
        let value: String = game
            .view("get_claimable")
            .args_json(json!({"mode":0,"round_id":0,"account":actor.id()}))
            .await?
            .json()?;
        assert_eq!(value, "0");
    }
    let prior = credit(&game, winner).await?;
    let paid: String = winner
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert_eq!(paid.parse::<u128>()?, winner_payout + STAKE);
    assert_eq!(credit(&game, winner).await? - prior, winner_payout + STAKE);
    let claimed = ledger(&game).await?;
    assert_eq!(amount(&claimed, "open_stakes")?, 0);
    assert_eq!(amount(&claimed, "claimable")?, 0);
    assert_eq!(
        amount(&claimed, "credit")? - amount(&final_ledger, "credit")?,
        winner_payout + STAKE
    );
    let duplicate = winner
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("duplicate claim");
    assert!(format!("{duplicate:?}").contains("E56"));
    println!(
        "SWEEP fixture: {unrevealed} unrevealed, one correct at seq={winner_seq}, {} distinct 64-character accounts, final_unrevealed={remaining}, one-yocto seed, dust={dust}; local MOCK OutLayer only",
        actors.len()
    );
    Ok(())
}

#[tokio::main]
async fn main() -> Res<()> {
    println!("LOCAL SANDBOX / MOCK OUTLAYER: genuine yield/resume; not real OutLayer or testnet");
    let worker = near_workspaces::sandbox().await?;
    let rule = rule_core::CanonicalRule::new(
        rule_core::Form::Or,
        vec![
            rule_core::Literal {
                atom: rule_core::Atom::new(0).unwrap(),
                negated: false,
            },
            rule_core::Literal {
                atom: rule_core::Atom::new(49).unwrap(),
                negated: false,
            },
        ],
    )
    .map_err(|error| format!("invalid gas fixture rule: {error:?}"))?;
    assert_eq!(rule.literals().len(), 2);
    let commitment = serde_json::to_value(protocol::round_commitment(&rule, &[5u8; 32]))?;
    // Inline the common setup so the original start transaction remains available for tracing.
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
    token.call("new").args_json(json!({"minter":game.id(),"cap":"1000000000000000000000000000","metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}})).transact().await?.into_result()?;
    let mut config = sandbox_tests::params(mock.id().as_str());
    config["reveal_window_ns"] = json!(3_000_000_000u64);
    config["base_attempts"] = json!([2, 50]);
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
    resolve_checked(
        &mock,
        0,
        begin_value(commitment.as_str().ok_or("missing commitment")?),
        false,
    )
    .await?;
    trace(
        &worker,
        "start_round",
        tokio::time::timeout(Duration::from_secs(30), begin).await??,
        game.id().as_str(),
        &game,
        &token,
        &["on_begin"],
    )
    .await?;
    assert_eq!(round(&game).await?["phase"], "Investigation");

    let root = worker.root_account()?;
    let name = "x".repeat(64 - root.id().as_str().len() - 1);
    let alice = root
        .create_subaccount(&name)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(alice.id().as_str().len(), 64);
    println!(
        "FIXTURE actor={} length=64, daily rule=2 literals, solo attempts=2",
        alice.id()
    );
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let deposit = bounds["min"]
        .as_str()
        .ok_or("missing storage minimum")?
        .parse()?;
    for account in [alice.id(), game.id()] {
        alice
            .call(token.id(), "storage_deposit")
            .args_json(json!({"account_id":account,"registration_only":true}))
            .deposit(NearToken::from_yoctonear(deposit))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let registration = alice
        .call(game.id(), "register_token")
        .max_gas()
        .transact()
        .await?;
    trace(
        &worker,
        "register_token",
        registration,
        alice.id().as_str(),
        &game,
        &token,
        &["on_register"],
    )
    .await?;
    let token_state: String = game
        .view("get_token_state")
        .args_json(json!({"account":alice.id()}))
        .await?
        .json()?;
    assert_eq!(token_state, "registered");

    let removed: bool = alice
        .call(token.id(), "storage_unregister")
        .args_json(json!({"force":false}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert!(removed);
    let token_state: String = game
        .view("get_token_state")
        .args_json(json!({"account":alice.id()}))
        .await?
        .json()?;
    assert_eq!(token_state, "registered");

    // Failed referee calls refund their debits. The first paid YES fails at the
    // real token; the next YES carries its previous-YES context and mints.
    for (id, number, value, error, label) in [
        (1, 2, Value::Null, false, "null"),
        (2, 2, Value::Null, true, "failed promise"),
        (3, 2, json!({"v":1}), false, "mint failure"),
        (4, 4, json!({"v":1}), false, "context YES"),
    ] {
        if id == 4 {
            alice
                .call(token.id(), "storage_deposit")
                .args_json(json!({"account_id":alice.id(),"registration_only":true}))
                .deposit(NearToken::from_yoctonear(deposit))
                .max_gas()
                .transact()
                .await?
                .into_result()?;
        }
        let before = credit(&game, &alice).await?;
        let play = alice
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":number,"word":"otter"}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, id + 1).await?;
        assert!(credit(&game, &alice).await? < before, "play debit missing");
        resolve_checked(&mock, id, value, error).await?;
        let result = tokio::time::timeout(Duration::from_secs(30), play).await??;
        let methods: &[&str] = match id {
            3 => &["on_verdict", "mint", "on_mint", "mint_failure"],
            4 => &["on_verdict", "mint", "on_mint"],
            _ => &["on_verdict"],
        };
        trace(
            &worker,
            label,
            result,
            alice.id().as_str(),
            &game,
            &token,
            methods,
        )
        .await?;
        if id < 3 {
            assert_eq!(
                credit(&game, &alice).await?,
                before,
                "{label} did not refund credit"
            );
            let entity: Value = game
                .view("get_entity")
                .args_json(json!({"mode":0,"id":0,"account":alice.id()}))
                .await?
                .json()?;
            assert_eq!(entity["attempts"], 0);
            assert_eq!(entity["pending"], false);
            let rows: Vec<Value> = game
                .view("get_log")
                .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
                .await?
                .json()?;
            assert!(rows.is_empty(), "{label} logged a verdict");
        }
        if id >= 3 {
            assert_eq!(
                before - credit(&game, &alice).await?,
                17_680_000_000_000_000_000_000
            );
            let allowance = if id == 3 {
                500_000_000_000_000_000_000_000u128
            } else {
                499_900_000_000_000_000_000_000u128
            };
            assert_eq!(round(&game).await?["allowance_left"], allowance.to_string());
        }
    }
    let balance: String = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":alice.id()}))
        .await?
        .json()?;
    let rows: Vec<Value> = game
        .view("get_log")
        .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
        .await?
        .json()?;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["verdict"], true);
    assert_eq!(rows[0]["minted"], "0");
    assert!(rows[0]["play"]["prev"].is_null());
    assert_eq!(rows[1]["verdict"], true);
    assert_eq!(rows[1]["play"]["prev"]["number"], 2);
    assert_eq!(
        rows[1]["play"]["prev"]["word_id"],
        rows[0]["play"]["word_id"]
    );
    assert_eq!(balance, "100000000000000000000");
    assert_eq!(rows[1]["minted"].as_str(), Some(balance.as_str()));
    let supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(supply, balance);
    for row in &rows {
        let play: rule_core::Play = serde_json::from_value(row["play"].clone())?;
        assert!(rule_core::eval(&rule, &play));
    }
    println!(
        "MINT FAILURE restored full allowance; contextual YES minted {balance}; two paid debits exact"
    );

    let lock = alice.call(token.id(), "ft_transfer_call").args_json(json!({"receiver_id":game.id(),"amount":"1","msg":json!({"lock":{"mode":0,"round_id":1}}).to_string()}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    request("lock", &lock)?;
    let locked: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":1,"account":alice.id()}))
        .await?
        .json()?;
    assert_eq!(locked, "1");
    let unlock = alice
        .call(game.id(), "unlock")
        .args_json(json!({"mode":0,"round_id":1}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    trace(
        &worker,
        "unlock",
        unlock,
        alice.id().as_str(),
        &game,
        &token,
        &["on_unlock"],
    )
    .await?;
    let locked: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":1,"account":alice.id()}))
        .await?
        .json()?;
    let unlocked: String = token
        .view("ft_balance_of")
        .args_json(json!({"account_id":alice.id()}))
        .await?
        .json()?;
    assert_eq!(locked, "0");
    assert_eq!(unlocked, balance);

    for (seq, correct) in [(0, false), (1, true)] {
        let salt = [9 + seq as u8; 32];
        let hash = commit_hash(&game, &alice, &rule, salt);
        alice
            .call(game.id(), "commit_guess")
            .args_json(json!({"mode":0,"hash":hash}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        worker.fast_forward(5).await?;
        let reveal = alice.call(game.id(), "reveal_guess").args_json(json!({"mode":0,"commit_seq":seq,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":format!("{:02x}", 9 + seq).repeat(32)}))
            .gas(Gas::from_tgas(300)).transact_async().await?;
        wait_requests(&mock, 6 + seq).await?;
        withdraw_during_check(&alice, &game).await?;
        let before_verdict = credit(&game, &alice).await?;
        resolve_checked(&mock, 5 + seq, json!({"correct":correct}), false).await?;
        trace(
            &worker,
            if correct {
                "correct guess"
            } else {
                "wrong guess"
            },
            tokio::time::timeout(Duration::from_secs(30), reveal).await??,
            alice.id().as_str(),
            &game,
            &token,
            &["on_guess"],
        )
        .await?;
        wait_status(
            &game,
            seq as usize,
            if correct { "Correct" } else { "Wrong" },
        )
        .await?;
        let after_verdict = credit(&game, &alice).await?;
        if correct {
            assert_eq!(after_verdict, before_verdict);
        } else {
            assert_eq!(
                after_verdict - before_verdict,
                50_000_000_000_000_000_000_000
            );
        }
        let before = credit(&game, &alice).await?;
        let withdrawal = alice
            .call(game.id(), "withdraw_credit")
            .args_json(json!({"amount":"1"}))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?;
        withdrawal.into_result()?;
        assert_eq!(credit(&game, &alice).await?, before - 1);
    }
    assert_eq!(round(&game).await?["phase"], "Reveal");
    assert_eq!(round(&game).await?["pot"], "66000000000000000000000");
    let deadline = round(&game).await?["reveal_deadline_ns"]
        .as_u64()
        .ok_or("missing reveal deadline")?;
    let mut deadline_reached = false;
    for _ in 0..100 {
        let block = rpc(&worker, "block", json!({"finality":"final"}))?;
        if block["header"]["timestamp"]
            .as_u64()
            .ok_or("missing block timestamp")?
            >= deadline
        {
            deadline_reached = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if !deadline_reached {
        return Err("reveal deadline was not observed within bounded wait".into());
    }
    let finalize = alice
        .call(game.id(), "finalize")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 8).await?;
    resolve_checked(
        &mock,
        7,
        json!({"rule":serde_json::to_value(&rule)?,"salt":"05".repeat(32)}),
        false,
    )
    .await?;
    trace(
        &worker,
        "finalize",
        tokio::time::timeout(Duration::from_secs(30), finalize).await??,
        alice.id().as_str(),
        &game,
        &token,
        &["on_open"],
    )
    .await?;
    let settled = round(&game).await?;
    assert_eq!(settled["phase"], "Settled");
    assert_eq!(settled["rule"], serde_json::to_value(&rule)?);
    let before = credit(&game, &alice).await?;
    let claim = alice
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?;
    request("claim", &claim)?;
    assert_eq!(
        credit(&game, &alice).await? - before,
        152_800_000_000_000_000_000_000
    );
    sweep_fixture(&worker, &rule, 21, 21).await?;
    sweep_fixture(&worker, &rule, 39, 19).await?;
    println!(
        "GAS units: 1 Tgas = {TGAS} gas; prepaid_action_gas is allocation, burnt_gas is consumption, outgoing IDs are not gas consumption."
    );
    Ok(())
}
