//! Local live-balance reconciliation with real game/token wasm and MOCK OutLayer.
//! Run in WSL with the prebuilt artifacts: cargo run -p sandbox-tests --profile fast --example balance
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use protocol::RuleHex;
use serde_json::{Value, json};
use std::time::Duration;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const DEPOSIT: u128 = NEAR / 1_000;
const FEE: u128 = NEAR / 100;
const RECORD: u128 = 7_680_000_000_000_000_000_000;
const ACCOUNT: u128 = 1_600_000_000_000_000_000_000;
const STAKE: u128 = NEAR / 10;
const FIELDS: [&str; 11] = [
    "credit",
    "vault",
    "round_pots",
    "carry",
    "open_stakes",
    "claimable",
    "compute_float",
    "platform_accrued",
    "storage_reserve",
    "pending_credit",
    "locked_storage",
];

fn amount(value: &Value, key: &str) -> Res<u128> {
    Ok(value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string {key}: {value}"))?
        .parse()?)
}

// Workspaces disables its experimental RPC helpers; query only the isolated sandbox.
fn rpc(worker: &Worker<Sandbox>, method: &str, params: Value) -> Res<Value> {
    let body = json!({"jsonrpc":"2.0","id":"balance","method":method,"params":params});
    let out = std::process::Command::new("curl")
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
    if !out.status.success() {
        return Err(format!(
            "{method} {body}: {}; response={}",
            String::from_utf8_lossy(&out.stderr),
            String::from_utf8_lossy(&out.stdout)
        )
        .into());
    }
    let response: Value = serde_json::from_slice(&out.stdout)?;
    if let Some(error) = response.get("error") {
        return Err(format!("{method}: {error}").into());
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| format!("{method}: missing result").into())
}

fn balance(worker: &Worker<Sandbox>, account: &str) -> Res<u128> {
    amount(
        &rpc(
            worker,
            "query",
            json!({"request_type":"view_account","finality":"optimistic","account_id":account}),
        )?,
        "amount",
    )
}

// A detached transfer is not established by the initiating transaction's success.
// Match actual actions, executor, outcome and callback in the transaction receipt graph.
async fn payment_receipts(
    worker: &Worker<Sandbox>,
    tx: &str,
    sender: &str,
    game: &Contract,
    payment: (&str, u128, &Value),
    callback: &str,
    transfer_succeeds: bool,
) -> Res<()> {
    let (recipient, principal, before) = payment;
    for _ in 0..100 {
        let result = rpc(
            worker,
            "EXPERIMENTAL_tx_status",
            json!({"tx_hash":tx,"sender_account_id":sender,"wait_until":"INCLUDED"}),
        )?;
        let mut initiated = None;
        let mut transfer = None;
        let mut callback_done = None;
        let mut refunds = Vec::new();
        if let Some(outcomes) = result["receipts_outcome"].as_array() {
            for outcome in outcomes {
                let Some(id) = outcome["id"].as_str() else {
                    continue;
                };
                let receipt = rpc(worker, "EXPERIMENTAL_receipt", json!({"receipt_id":id}))?;
                if receipt["receipt_id"] != id
                    || receipt["receiver_id"] != outcome["outcome"]["executor_id"]
                {
                    return Err(format!("receipt identity mismatch: {id}").into());
                }
                let Some(actions) = receipt["receipt"]["Action"]["actions"].as_array() else {
                    continue;
                };
                let status = &outcome["outcome"]["status"];
                let success = status.get("SuccessValue").is_some()
                    || status.get("SuccessReceiptId").is_some();
                let initiating_method = match callback {
                    "on_withdraw" => "withdraw_credit",
                    "on_platform" => "claim_platform",
                    _ => return Err(format!("unsupported payment callback {callback}").into()),
                };
                if receipt["receiver_id"] == game.id().as_str()
                    && actions
                        .iter()
                        .any(|a| a["FunctionCall"]["method_name"] == initiating_method)
                {
                    if !success {
                        return Err("payment initiation failed".into());
                    }
                    initiated = Some(outcome.clone());
                }
                if receipt["predecessor_id"] == "system"
                    && receipt["receiver_id"] == game.id().as_str()
                    && actions
                        .iter()
                        .any(|a| a["Transfer"]["deposit"] == principal.to_string())
                {
                    if !success {
                        return Err("principal refund failed".into());
                    }
                    refunds.push(outcome.clone());
                }
                if receipt["predecessor_id"] == game.id().as_str()
                    && receipt["receiver_id"] == recipient
                {
                    for action in actions {
                        if let Some(deposit) = action
                            .get("Transfer")
                            .and_then(|t| t.get("deposit"))
                            .and_then(Value::as_str)
                            && deposit.parse::<u128>()? == principal
                        {
                            if success != transfer_succeeds
                                || (!success && status.get("Failure").is_none())
                            {
                                return Err(format!(
                                    "transfer receipt {id} unexpected status: {status}"
                                )
                                .into());
                            }
                            transfer = Some(outcome.clone());
                            println!(
                                "TRANSFER receipt={id} receiver={recipient} principal={principal} status={status}"
                            );
                        }
                    }
                }
                if receipt["receiver_id"] == game.id().as_str()
                    && actions
                        .iter()
                        .any(|a| a["FunctionCall"]["method_name"] == callback)
                {
                    if !success {
                        return Err(format!("{callback} receipt {id} failed: {status}").into());
                    }
                    callback_done = Some(outcome.clone());
                    println!("CALLBACK {callback} receipt={id} status={status}");
                }
            }
        }
        if let (Some(start), Some(paid), Some(done)) = (initiated, transfer, callback_done) {
            // A failed Transfer creates its own principal-refund receipt. Match the
            // parent receipt id, not an unrelated gas refund of a similar amount.
            let refund = refunds.iter().find(|r| {
                paid["outcome"]["receipt_ids"]
                    .as_array()
                    .is_some_and(|ids| ids.contains(&r["id"]))
            });
            if transfer_succeeds || refund.is_some() {
                payment_history(
                    worker,
                    game,
                    before,
                    (callback, principal, transfer_succeeds),
                    (&start, &paid, &done, refund),
                )?;
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!(
        "tx {tx}: missing transfer to {recipient} for {principal}, {callback}, or principal refund"
    )
    .into())
}

// Re-read every actual block between initiation and completion. This observes
// in-flight state without racing a live poll or modifying sandbox contract state.
fn payment_history(
    worker: &Worker<Sandbox>,
    game: &Contract,
    before: &Value,
    payment: (&str, u128, bool),
    outcomes: (&Value, &Value, &Value, Option<&Value>),
) -> Res<()> {
    let (callback, principal, succeeds) = payment;
    let (start, paid, done, refund) = outcomes;
    let height = |outcome: &Value| -> Res<u64> {
        let block = rpc(worker, "block", json!({"block_id":outcome["block_hash"]}))?;
        block["header"]["height"]
            .as_u64()
            .ok_or_else(|| "missing block height".into())
    };
    let (started, transferred, completed) = (height(start)?, height(paid)?, height(done)?);
    let refunded = refund.map(height).transpose()?;
    if started >= transferred
        || transferred >= completed
        || refunded.is_some_and(|h| h <= transferred)
    {
        return Err(format!(
            "unexpected receipt order: {started}/{transferred}/{completed}/{refunded:?}"
        )
        .into());
    }
    let field = if callback == "on_withdraw" {
        "credit"
    } else {
        "platform_accrued"
    };
    for h in started..=completed.max(refunded.unwrap_or(completed)) {
        let view = rpc(
            worker,
            "query",
            json!({
                "request_type":"call_function","block_id":h,
                "account_id":game.id(),"method_name":"get_ledger","args_base64":"e30="
            }),
        )?;
        let ledger = ledger_from_view(worker, game, &view)?;
        let restored = !succeeds && h >= completed;
        let pending_native = amount(&ledger, "pending_native_payments")?;
        if pending_native != if h < completed { principal } else { 0 } {
            return Err(format!(
                "block {h}: native reservation {pending_native} does not match callback completion"
            )
            .into());
        }
        delta(
            "historical payment",
            before,
            &ledger,
            &[(field, if restored { 0 } else { -(principal as i128) })],
        )?;
        // Outgoing principal is escrow before execution. After a failed transfer,
        // its linked system refund is a receivable until that receipt executes.
        // A successful transfer is paid, never an asset or refund obligation.
        let escrow_or_receivable =
            h < transferred || (!succeeds && h < refunded.ok_or("missing refund")?);
        let refund_exposure = h < transferred || (!succeeds && h < completed);
        let assets = amount(&ledger, "balance")? + if escrow_or_receivable { principal } else { 0 };
        let liabilities = obligations(&ledger)? + if refund_exposure { principal } else { 0 };
        if assets < liabilities {
            return Err(
                format!("block {h}: payment assets {assets} < liabilities {liabilities}").into(),
            );
        }
        println!(
            "PAYMENT BLOCK {h} {callback}: balance={} principal={principal} escrow_or_receivable={escrow_or_receivable} refund_exposure={refund_exposure} restored={restored} assets={assets} liabilities={liabilities}",
            amount(&ledger, "balance")?
        );
    }
    println!(
        "PAYMENT ORDER {callback}: initiated={started} transfer={transferred} callback={completed} principal_refund={refunded:?}; historical same-block ledger/account snapshots"
    );
    Ok(())
}

async fn snapshot(worker: &Worker<Sandbox>, game: &Contract, label: &str) -> Res<Value> {
    // The default workspaces view and a final RPC account query can observe different
    // blocks. Pin both sides to the same optimistic sandbox block instead.
    let view = rpc(
        worker,
        "query",
        json!({
            "request_type":"call_function","finality":"optimistic",
            "account_id":game.id(),"method_name":"get_ledger","args_base64":"e30="
        }),
    )?;
    let ledger = ledger_from_view(worker, game, &view)?;
    let real = amount(&ledger, "balance")?;
    let obligations = obligations(&ledger)?;
    println!("BALANCE {label}: rpc={real} obligations={obligations} ledger={ledger}");
    if real < obligations {
        return Err(
            format!("{label}: insolvency: balance {real} < obligations {obligations}").into(),
        );
    }
    Ok(ledger)
}

fn ledger_from_view(worker: &Worker<Sandbox>, game: &Contract, view: &Value) -> Res<Value> {
    let bytes: Vec<u8> = serde_json::from_value(view["result"].clone())?;
    let ledger: Value = serde_json::from_slice(&bytes)?;
    let account = rpc(
        worker,
        "query",
        json!({
            "request_type":"view_account","block_id":view["block_hash"],"account_id":game.id()
        }),
    )?;
    let real = amount(&account, "amount")?;
    if real != amount(&ledger, "balance")? {
        return Err("same-block balance disagrees with contract view".into());
    }
    Ok(ledger)
}

fn obligations(ledger: &Value) -> Res<u128> {
    let mut obligations = 0u128;
    for key in [
        "credit",
        "vault",
        "round_pots",
        "carry",
        "open_stakes",
        "claimable",
        "compute_float",
        "platform_accrued",
        "pending_credit",
    ] {
        obligations = obligations
            .checked_add(amount(ledger, key)?)
            .ok_or("obligations overflow")?;
    }
    obligations = obligations
        .checked_add(amount(ledger, "storage_reserve")?.max(amount(ledger, "locked_storage")?))
        .ok_or("obligations overflow")?;
    Ok(obligations)
}

// Compare every obligation, not just their sum. Collateral changes with actual storage.
fn delta(label: &str, before: &Value, after: &Value, changes: &[(&str, i128)]) -> Res<()> {
    for field in FIELDS {
        if field == "locked_storage" {
            continue;
        }
        let actual =
            i128::try_from(amount(after, field)?)? - i128::try_from(amount(before, field)?)?;
        let expected = changes
            .iter()
            .find(|(name, _)| *name == field)
            .map_or(0, |(_, n)| *n);
        if actual != expected {
            return Err(format!("{label}: {field} delta {actual}, expected {expected}; before={before}, after={after}").into());
        }
    }
    Ok(())
}

async fn wait_round(game: &Contract, phase: &str) -> Res<()> {
    for _ in 0..50 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":null}))
            .await?
            .json()?;
        if round["phase"] == phase {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("round never reached {phase}").into())
}

async fn wait_player(game: &Contract, player: &Account, pending: bool) -> Res<()> {
    for _ in 0..50 {
        let p: Value = game
            .view("get_player")
            .args_json(json!({"account":player.id()}))
            .await?
            .json()?;
        if p["pending_play"] == pending && p["pending_withdrawal"] == pending {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!("player {} pending never became {pending}", player.id()).into())
}

async fn resolve_checked(mock: &Contract, id: u32, value: Value, error: bool) -> Res<()> {
    let resumed: bool = mock
        .call("resolve")
        .args_json(json!({"id":id,"resolution":{"value":value,"error":error}}))
        .max_gas()
        .transact()
        .await?
        .into_result()?
        .json()?;
    if !resumed {
        return Err(format!("mock request {id} did not resume").into());
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Res<()> {
    println!(
        "LOCAL SANDBOX: real game/token wasm, MOCK OutLayer yield/resume; not testnet or real OutLayer evidence"
    );
    let worker = near_workspaces::sandbox().await?;
    let alice = worker.dev_create_account().await?;
    let root = worker.root_account()?;
    let platform_id = format!("platform.{}", root.id());
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
    fund_token_operations(&token).await?;
    let mut params = sandbox_tests::params(mock.id().as_str());
    params["token"] = json!(token.id());
    params["platform"] = json!(platform_id);
    params["reveal_window_ns"] = json!(3_000_000_000u64);
    params["outlayer_deposit"] = json!({"begin":DEPOSIT.to_string(),"verdict":DEPOSIT.to_string(),"guess":DEPOSIT.to_string(),"open":DEPOSIT.to_string()});
    game.call("new")
        .args_json(json!({"params":params,"demo":true}))
        .transact()
        .await?
        .into_result()?;
    let (rule, _) = rule_core::sample(b"sandbox-balance");
    let commitment = serde_json::to_value(protocol::round_commitment(&rule, &[5; 32]))?;
    let mut last = snapshot(&worker, &game, "initialized").await?;
    alice
        .call(game.id(), "fund_compute")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let next = snapshot(&worker, &game, "fund compute").await?;
    delta(
        "fund compute",
        &last,
        &next,
        &[("compute_float", NEAR as i128)],
    )?;
    last = next;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(2))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let next = snapshot(&worker, &game, "deposit credit").await?;
    delta(
        "deposit credit",
        &last,
        &next,
        &[
            ("credit", (2 * NEAR - ACCOUNT) as i128),
            ("storage_reserve", ACCOUNT as i128),
        ],
    )?;
    last = next;

    let mock_before = balance(&worker, mock.id().as_str())?;
    let begin = alice
        .call(game.id(), "start_round")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 1).await?;
    let next = snapshot(&worker, &game, "begin pending").await?;
    delta(
        "begin pending",
        &last,
        &next,
        &[("compute_float", -(DEPOSIT as i128))],
    )?;
    last = next;
    let mock_after = balance(&worker, mock.id().as_str())?;
    if mock_after < mock_before + DEPOSIT {
        return Err(format!("mock did not receive begin principal: before={mock_before} after={mock_after} principal={DEPOSIT}; receiver gas reward may increase balance").into());
    }
    resolve_checked(
        &mock,
        0,
        begin_value(commitment.as_str().ok_or("missing commitment")?),
        false,
    )
    .await?;
    begin.await?.into_result()?;
    wait_round(&game, "Investigation").await?;
    let next = snapshot(&worker, &game, "begin complete").await?;
    delta("begin complete", &last, &next, &[])?;
    last = next;

    // A failed first play must not delete an entity with an overlapping commit.
    let play = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":2,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    let next = snapshot(&worker, &game, "first play pending").await?;
    delta(
        "first play pending",
        &last,
        &next,
        &[
            ("credit", -((FEE + RECORD) as i128)),
            ("pending_credit", (FEE + RECORD) as i128),
            ("compute_float", -(DEPOSIT as i128)),
        ],
    )?;
    last = next;
    let hash = commit_hash(&game, &alice, &rule, [9; 32]);
    alice
        .call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":hash}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let next = snapshot(&worker, &game, "correct commit overlaps first play").await?;
    delta(
        "overlapping commit",
        &last,
        &next,
        &[
            ("credit", -((STAKE + RECORD) as i128)),
            ("open_stakes", STAKE as i128),
            ("storage_reserve", RECORD as i128),
        ],
    )?;
    last = next;
    for seq in 1..=2u8 {
        let hash = commit_hash(&game, &alice, &rule, [9 + seq; 32]);
        alice
            .call(game.id(), "commit_guess")
            .args_json(json!({"mode":0,"hash":hash}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let next = snapshot(&worker, &game, "additional overlapping commit").await?;
        delta(
            "overlapping commit",
            &last,
            &next,
            &[
                ("credit", -((STAKE + RECORD) as i128)),
                ("open_stakes", STAKE as i128),
                ("storage_reserve", RECORD as i128),
            ],
        )?;
        last = next;
    }
    resolve_checked(&mock, 1, Value::Null, true).await?;
    play.await?.into_result()?;
    wait_player(&game, &alice, false).await?;
    let next = snapshot(&worker, &game, "overlapping first play refunded").await?;
    delta(
        "play refund",
        &last,
        &next,
        &[
            ("credit", (FEE + RECORD) as i128),
            ("pending_credit", -((FEE + RECORD) as i128)),
        ],
    )?;
    last = next;
    let extra_hash = commit_hash(&game, &alice, &rule, [12; 32]);
    let extra = alice
        .call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":extra_hash}))
        .max_gas()
        .transact()
        .await?;
    let error = extra
        .into_result()
        .expect_err("three surviving commits must enforce E15 after failed play");
    if !format!("{error:?}").contains("E15") {
        return Err(format!("overlap commit cap: expected E15, got {error:?}").into());
    }
    let next = snapshot(&worker, &game, "commit cap survived failed first play").await?;
    delta("overlap commit cap", &last, &next, &[])?;
    last = next;

    let play = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":2,"word":"otter"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 3).await?;
    let next = snapshot(&worker, &game, "successful play pending").await?;
    delta(
        "play pending",
        &last,
        &next,
        &[
            ("credit", -((FEE + RECORD) as i128)),
            ("pending_credit", (FEE + RECORD) as i128),
            ("compute_float", -(DEPOSIT as i128)),
        ],
    )?;
    last = next;
    resolve_checked(&mock, 2, json!({"v":0}), false).await?;
    play.await?.into_result()?;
    wait_player(&game, &alice, false).await?;
    let next = snapshot(&worker, &game, "successful play settled").await?;
    delta(
        "play settlement",
        &last,
        &next,
        &[
            ("pending_credit", -((FEE + RECORD) as i128)),
            ("round_pots", (FEE * 80 / 100) as i128),
            ("compute_float", (FEE * 15 / 100) as i128),
            ("platform_accrued", (FEE * 5 / 100) as i128),
            ("storage_reserve", RECORD as i128),
        ],
    )?;
    last = next;

    // The correct stake was committed during the first play and stays open until claim.
    for (request, seq, status) in [(3u32, 1u32, "Wrong"), (4, 2, "Refunded"), (5, 0, "Correct")] {
        // All three commits were created while the first play was pending.
        worker.fast_forward(5).await?;
        let reveal = alice.call(game.id(), "reveal_guess").args_json(json!({"mode":0,"commit_seq":seq,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":format!("{:02x}", 9+seq).repeat(32)})).gas(Gas::from_tgas(300)).transact_async().await?;
        wait_requests(&mock, request + 1).await?;
        wait_status(&game, seq as usize, "Checking").await?;
        let next = snapshot(&worker, &game, "guess checking").await?;
        delta(
            "guess checking",
            &last,
            &next,
            &[("compute_float", -(DEPOSIT as i128))],
        )?;
        last = next;
        resolve_checked(
            &mock,
            request,
            if status == "Refunded" {
                Value::Null
            } else {
                json!({"correct":status == "Correct"})
            },
            status == "Refunded",
        )
        .await?;
        reveal.await?.into_result()?;
        wait_status(&game, seq as usize, status).await?;
        let next = snapshot(&worker, &game, status).await?;
        match status {
            "Wrong" => delta(
                status,
                &last,
                &next,
                &[
                    ("open_stakes", -(STAKE as i128)),
                    ("credit", (STAKE / 2) as i128),
                    ("round_pots", (STAKE / 2) as i128),
                ],
            )?,
            "Refunded" => delta(
                status,
                &last,
                &next,
                &[("open_stakes", -(STAKE as i128)), ("credit", STAKE as i128)],
            )?,
            _ => delta(status, &last, &next, &[])?,
        }
        last = next;
    }
    wait_round(&game, "Reveal").await?;
    let mut finalize = None;
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        worker.fast_forward(2).await?;
        let result = alice
            .call(game.id(), "finalize")
            .args_json(json!({"mode":0}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?
            .await?;
        if result.is_success() {
            finalize = Some(result);
            break;
        }
        let error = result
            .into_result()
            .expect_err("failed finalize must have an error");
        if !format!("{error:?}").contains("E50") {
            return Err(format!("finalize unexpected failure: {error:?}").into());
        }
    }
    finalize
        .ok_or("finalize never became available")?
        .into_result()?;
    wait_requests(&mock, 7).await?;
    wait_round(&game, "Opening").await?;
    let next = snapshot(&worker, &game, "open pending").await?;
    delta(
        "open pending",
        &last,
        &next,
        &[("compute_float", -(DEPOSIT as i128))],
    )?;
    last = next;
    resolve_checked(
        &mock,
        6,
        json!({"rule":serde_json::to_value(&rule)?,"salt":"05".repeat(32)}),
        false,
    )
    .await?;
    wait_round(&game, "Settled").await?;
    let pot = FEE * 80 / 100 + STAKE / 2;
    let payout = pot * 80 / 100;
    let next = snapshot(&worker, &game, "settled").await?;
    delta(
        "settled",
        &last,
        &next,
        &[
            ("round_pots", -(pot as i128)),
            ("carry", (pot / 10) as i128),
            ("claimable", payout as i128),
            ("platform_accrued", (pot / 10) as i128),
        ],
    )?;
    last = next;
    let claimable: String = game
        .view("get_claimable")
        .args_json(json!({"mode":0,"round_id":0,"account":alice.id()}))
        .await?
        .json()?;
    if claimable.parse::<u128>()? != payout + STAKE {
        return Err(format!("claimable {claimable}, expected {}", payout + STAKE).into());
    }
    alice
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let next = snapshot(&worker, &game, "claimed to credit").await?;
    delta(
        "claim",
        &last,
        &next,
        &[
            ("credit", (payout + STAKE) as i128),
            ("claimable", -(payout as i128)),
            ("open_stakes", -(STAKE as i128)),
        ],
    )?;
    last = next;

    let principal = NEAR / 2;
    let recipient_before = balance(&worker, alice.id().as_str())?;
    let withdrawal = alice
        .call(game.id(), "withdraw_credit")
        .args_json(json!({"amount":principal.to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    let tx = withdrawal.outcome().transaction_hash.to_string();
    withdrawal.into_result()?;
    payment_receipts(
        &worker,
        &tx,
        alice.id().as_str(),
        &game,
        (alice.id().as_str(), principal, &last),
        "on_withdraw",
        true,
    )
    .await?;
    wait_player(&game, &alice, false).await?;
    let next = snapshot(&worker, &game, "withdrawal callback complete").await?;
    delta(
        "withdraw",
        &last,
        &next,
        &[("credit", -(principal as i128))],
    )?;
    last = next;
    let recipient_after = balance(&worker, alice.id().as_str())?;
    println!(
        "WITHDRAW recipient net={} principal={principal}; net includes signer gas, outstanding refunds from earlier transactions and attached 1 yocto. Gross principal is proved by the successful Transfer receipt, not a bound on net movement.",
        i128::try_from(recipient_after)? - i128::try_from(recipient_before)?
    );

    let platform_principal = amount(&last, "platform_accrued")?;
    let failed = alice
        .call(game.id(), "claim_platform")
        .max_gas()
        .transact()
        .await?;
    let tx = failed.outcome().transaction_hash.to_string();
    failed.into_result()?;
    payment_receipts(
        &worker,
        &tx,
        alice.id().as_str(),
        &game,
        (&platform_id, platform_principal, &last),
        "on_platform",
        false,
    )
    .await?;
    let next = snapshot(&worker, &game, "failed platform transfer restored").await?;
    delta("failed platform transfer", &last, &next, &[])?;
    last = next;
    let platform = root
        .create_subaccount("platform")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    if platform.id().as_str() != platform_id {
        return Err("created platform has unexpected id".into());
    }
    let platform_before = balance(&worker, platform.id().as_str())?;
    let paid = alice
        .call(game.id(), "claim_platform")
        .max_gas()
        .transact()
        .await?;
    let tx = paid.outcome().transaction_hash.to_string();
    paid.into_result()?;
    payment_receipts(
        &worker,
        &tx,
        alice.id().as_str(),
        &game,
        (&platform_id, platform_principal, &last),
        "on_platform",
        true,
    )
    .await?;
    let mut platform_after = platform_before;
    for _ in 0..50 {
        platform_after = balance(&worker, platform.id().as_str())?;
        if platform_after == platform_before + platform_principal {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if platform_after != platform_before + platform_principal {
        return Err(format!("platform recipient: before={platform_before} after={platform_after} expected principal={platform_principal}").into());
    }
    let next = snapshot(&worker, &game, "platform paid").await?;
    delta(
        "platform payout",
        &last,
        &next,
        &[("platform_accrued", -(platform_principal as i128))],
    )?;
    println!(
        "PLATFORM recipient exact increase={platform_principal}; recipient neither signs nor executes a function call"
    );
    println!(
        "LIMITS: sampled Solo sequence only; no Team, 10k sequences, real referee, or testnet. Historical payment blocks cover initiation, transfer, callback and linked principal refund without state patching. They do not prove recovery if a payment callback never executes. pending_credit is only unsettled play fee/storage. Contract execution rewards and gas rebates can change RPC balances independently of principal; signer net is not gross principal."
    );
    Ok(())
}
