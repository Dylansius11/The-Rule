//! Local storage measurements using the real game/token wasm and MOCK OutLayer, not testnet.
//! Run in WSL after building sandbox artifacts: `cargo run -p sandbox-tests --profile fast --example storage`.
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use protocol::{CommitPreimage, Entity, Mode, RuleHex};
use serde_json::{Value, json};
use std::collections::BTreeMap;

// The shared fixture permits only one solo attempt and has no lock tiers. Change
// only that unrelated limit here; storage charges remain the shared fixture's.
async fn start_storage(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    commit: &str,
) -> Res<Env> {
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
    token
        .call("new")
        .args_json(json!({
            "minter":game.id(),"cap":"1000000000000000000000000000",
            "metadata":{"spec":"ft-1.0.0","name":"THE RULE","symbol":"RULE","decimals":18}
        }))
        .transact()
        .await?
        .into_result()?;
    fund_token_operations(&token).await?;
    let mut config = sandbox_tests::params(mock.id().as_str());
    config["base_attempts"][0] = json!(10);
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
    for _ in 0..50 {
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

// NEAR's per-trie-record overhead. The account-level storage_usage is authoritative;
// per-prefix figures below are diagnostics and should be compared with that total.
const RECORD_OVERHEAD: usize = 40;

struct Snapshot {
    usage: u64,
    prefixes: BTreeMap<u8, (usize, usize)>,
}

async fn snapshot(game: &Contract, label: &str) -> Res<Snapshot> {
    let usage = game.view_account().await?.storage_usage;
    let mut prefixes = BTreeMap::<u8, (usize, usize)>::new();
    for (key, value) in game.view_state().await? {
        if let Some(prefix) = key.first() {
            let entry = prefixes.entry(*prefix).or_default();
            entry.0 += 1;
            entry.1 += key.len() + value.len() + RECORD_OVERHEAD;
        }
    }
    print!("STORAGE {label}: account={usage} bytes; prefixes");
    for (prefix, (count, bytes)) in &prefixes {
        print!(" {}={count}/{bytes}B", char::from(*prefix));
    }
    println!();
    Ok(Snapshot { usage, prefixes })
}

fn delta(after: &Snapshot, before: &Snapshot) -> i128 {
    i128::from(after.usage) - i128::from(before.usage)
}

fn count(s: &Snapshot, prefix: u8) -> usize {
    s.prefixes.get(&prefix).map_or(0, |entry| entry.0)
}

fn check_charge(
    label: &str,
    before: &Snapshot,
    after: &Snapshot,
    charge: u128,
    byte_cost: u128,
    failures: &mut usize,
) {
    let growth = delta(after, before).max(0) as u128;
    let cost = growth * byte_cost;
    let shortfall = cost.saturating_sub(charge);
    println!(
        "RETAINED {label}: {growth} bytes; cost={cost} yocto; charge={charge} yocto; shortfall={shortfall} yocto"
    );
    if shortfall > 0 {
        *failures += 1;
    }
}

fn peak(label: &str, before: &Snapshot, pending: &Snapshot, byte_cost: u128) {
    let bytes = delta(pending, before).max(0) as u128;
    println!(
        "TRANSIENT {label}: observed growth={bytes} bytes, gross collateral={} yocto; funded from operator liquidity until charges are retained; not a concurrency bound",
        bytes * byte_cost
    );
}

async fn wait_log(game: &Contract, n: usize) -> Res<Vec<Value>> {
    for _ in 0..50 {
        let rows: Vec<Value> = game
            .view("get_log")
            .args_json(json!({"mode":0,"id":0,"from_idx":0,"limit":200}))
            .await?
            .json()?;
        if rows.len() == n {
            return Ok(rows);
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!("log never reached {n} rows").into())
}

async fn wait_token(game: &Contract, player: &Account) -> Res<()> {
    for _ in 0..50 {
        let state: String = game
            .view("get_token_state")
            .args_json(json!({"account":player.id()}))
            .await?
            .json()?;
        if state == "registered" {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("token registration check never completed".into())
}

async fn wait_balance(token: &Contract, player: &Account) -> Res<()> {
    for _ in 0..50 {
        let amount: String = token
            .view("ft_balance_of")
            .args_json(json!({"account_id":player.id()}))
            .await?
            .json()?;
        if amount.parse::<u128>()? >= 2 {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("mint never credited the player".into())
}

async fn wait_no_pending(game: &Contract, label: &str) -> Res<Snapshot> {
    for _ in 0..50 {
        let state = snapshot(game, label).await?;
        if count(&state, b'p') == 0 {
            return Ok(state);
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!("{label}: pending request never cleared").into())
}

#[tokio::main]
async fn main() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let (rule, _) = rule_core::sample(b"sandbox-storage");
    let commitment = serde_json::to_value(protocol::round_commitment(&rule, &[5; 32]))?;
    let Env { mock, game, token } =
        start_storage(&worker, commitment.as_str().ok_or("bad commitment")?).await?;
    println!(
        "FIXTURE solo base_attempts=10; all storage charges unchanged from sandbox_tests::params"
    );
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
        "SAMPLE player={} (64 bytes); numeric values and sequences are reachable samples, not u64 maxima",
        alice.id()
    );

    // A conservative serialization bound, not an assertion that these maxima
    // coexist or are reachable. JSON numbers vary in width, unlike fixed-width Borsh.
    let bound_row = protocol::events::LogRow {
        log_idx: u32::MAX,
        seq: u64::MAX,
        play_key: u64::MAX.to_string(),
        entity_tag: 1,
        entity_id: u32::MAX,
        actor: u32::MAX,
        account: alice.id().to_string(),
        play: rule_core::Play::new(
            999,
            127,
            9,
            Some(rule_core::Previous {
                number: 999,
                word_id: 127,
                gap_bucket: 2,
            }),
        )
        .unwrap(),
        verdict: false,
        minted: protocol::params::Amount(u128::MAX),
    };
    let bound_json_bytes = serde_json::to_vec(&bound_row)?.len();
    println!(
        "BOUND analytical log entry: JSON <= {bound_json_bytes} bytes; Borsh string + map key + 40-byte record overhead <= {} bytes; independent type maxima, not a reachable observation",
        bound_json_bytes + 4 + 10 + RECORD_OVERHEAD
    );
    // Verdict request: prefix + u64 key, enum tag, mode, round, entity,
    // 64-byte AccountId, JSON string, key/seq/timestamp/deadline and trie overhead.
    let play_json_bound = serde_json::to_vec(&bound_row.play)?.len();
    let verdict_record_bound =
        9 + 1 + 1 + 4 + 5 + 4 + 64 + 4 + play_json_bound + 8 + 8 + 8 + 8 + RECORD_OVERHEAD;
    // Guess request has only mode, round, commit_seq and expiry.
    let guess_record_bound = 9 + 1 + 1 + 4 + 4 + 8 + RECORD_OVERHEAD;
    println!(
        "BOUND request records: verdict <= {verdict_record_bound} B (play JSON <= {play_json_bound} B), guess = {guess_record_bound} B; excludes seen/entity and other request variants"
    );

    let config: Value = game.view("get_params").await?.json()?;
    let referee_cap = config["max_pending_referee_requests"]
        .as_u64()
        .ok_or("missing max_pending_referee_requests")?;
    let user_limit = config["user_referee_request_limit"]
        .as_u64()
        .ok_or("missing user_referee_request_limit")?;
    let account_charge: u128 = config["storage_charge_account"]
        .as_str()
        .ok_or("missing account charge")?
        .parse()?;
    let record_charge: u128 = config["storage_charge_per_play"]
        .as_str()
        .ok_or("missing record charge")?
        .parse()?;
    let baseline = snapshot(&game, "baseline").await?;
    let ledger: Value = game.view("get_ledger").await?.json()?;
    let locked: u128 = ledger["locked_storage"]
        .as_str()
        .ok_or("missing locked storage")?
        .parse()?;
    let byte_cost = locked
        .checked_div(u128::from(baseline.usage))
        .ok_or("zero baseline storage")?;
    if byte_cost == 0 || byte_cost * u128::from(baseline.usage) != locked {
        return Err("cannot determine exact storage byte cost".into());
    }
    println!(
        "COST sandbox byte_cost={byte_cost} yocto; actual configured account={account_charge}, record={record_charge}"
    );
    let mut failures = 0;

    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(2))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let account = snapshot(&game, "64-character player registered").await?;
    check_charge(
        "account",
        &baseline,
        &account,
        account_charge,
        byte_cost,
        &mut failures,
    );

    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let token_min = bounds["min"]
        .as_str()
        .ok_or("missing token minimum")?
        .parse()?;
    for id in [alice.id(), game.id()] {
        alice
            .call(token.id(), "storage_deposit")
            .args_json(json!({"account_id":id,"registration_only":true}))
            .deposit(NearToken::from_yoctonear(token_min))
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
    wait_token(&game, &alice).await?;
    let registered = snapshot(&game, "token check complete").await?;

    let first = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":999,"word":"nonce"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    let first_pending = snapshot(&game, "first play pending").await?;
    peak("first play", &registered, &first_pending, byte_cost);
    resolve(&mock, 1, json!({"v":1}), false).await?;
    first.await?.into_result()?;
    wait_log(&game, 1).await?;
    wait_balance(&token, &alice).await?;
    let first_yes = wait_no_pending(&game, "first play YES and mint completed").await?;
    check_charge(
        "first play YES including entity",
        &registered,
        &first_yes,
        record_charge,
        byte_cost,
        &mut failures,
    );
    println!(
        "LIMIT mint pending may appear opportunistically in snapshots; this report does not establish its maximum peak"
    );

    let before_lock_credit = credit(&game, &alice).await?;
    let lock_msg = json!({"lock":{"mode":0,"round_id":1}}).to_string();
    alice
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":game.id(),"amount":"1","msg":lock_msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let locked: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":1,"account":alice.id()}))
        .await?
        .json()?;
    if locked != "1" {
        return Err("new lock was not accepted".into());
    }
    let new_lock = snapshot(&game, "new lock").await?;
    check_charge(
        "new lock",
        &first_yes,
        &new_lock,
        record_charge,
        byte_cost,
        &mut failures,
    );
    alice
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id":game.id(),"amount":"1","msg":lock_msg}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let locked: String = game
        .view("get_lock")
        .args_json(json!({"mode":0,"round_id":1,"account":alice.id()}))
        .await?
        .json()?;
    if locked != "2" {
        return Err("lock top-up was not accepted".into());
    }
    let after_lock = snapshot(&game, "lock top-up").await?;
    if delta(&after_lock, &new_lock) != 0 {
        return Err("lock top-up changed storage usage".into());
    }
    if before_lock_credit - credit(&game, &alice).await? != record_charge {
        return Err("lock and top-up did not charge exactly once".into());
    }

    let second = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":998,"word":"stake"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 3).await?;
    let pending = snapshot(&game, "later play with previous YES pending").await?;
    peak(
        "later play with previous YES",
        &after_lock,
        &pending,
        byte_cost,
    );
    resolve(&mock, 2, json!({"v":0}), false).await?;
    second.await?.into_result()?;
    let rows = wait_log(&game, 2).await?;
    if rows[1]["play"]["prev"]["number"] != 999 || rows[1]["play"]["prev"]["word_id"] != 127 {
        return Err("later play did not preserve maximum previous values".into());
    }
    let no = snapshot(&game, "later play NO").await?;
    check_charge(
        "later play NO with previous YES",
        &after_lock,
        &no,
        record_charge,
        byte_cost,
        &mut failures,
    );

    let third = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":997,"word":"key"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 4).await?;
    let pending_yes = snapshot(&game, "repeat YES pending").await?;
    peak("repeat YES", &no, &pending_yes, byte_cost);
    resolve(&mock, 3, json!({"v":1}), false).await?;
    third.await?.into_result()?;
    wait_log(&game, 3).await?;
    let yes = wait_no_pending(&game, "repeat YES completed").await?;
    check_charge(
        "repeat YES",
        &no,
        &yes,
        record_charge,
        byte_cost,
        &mut failures,
    );

    let before_refund_credit = credit(&game, &alice).await?;
    let refunded = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":996,"word":"wallet"}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 5).await?;
    let refund_pending = snapshot(&game, "refunded play pending").await?;
    peak("refunded play", &yes, &refund_pending, byte_cost);
    resolve(&mock, 4, Value::Null, true).await?;
    refunded.await?.into_result()?;
    let mut refund_done = false;
    for _ in 0..50 {
        if credit(&game, &alice).await? == before_refund_credit {
            refund_done = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    if !refund_done {
        return Err("play credit was not refunded".into());
    }
    let after_refund = snapshot(&game, "refunded play settled").await?;
    if delta(&after_refund, &yes) != 0
        || count(&after_refund, b'p') != count(&yes, b'p')
        || count(&after_refund, b's') != count(&yes, b's')
    {
        return Err("refunded play left transient storage behind".into());
    }

    // A fresh player commits before playing, so the first commit pays for its entity record too.
    let bob_name = "y".repeat(name.len());
    let bob = root
        .create_subaccount(&bob_name)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(bob.id().as_str().len(), 64);
    bob.call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let before_commit = snapshot(&game, "second player registered").await?;
    let salt = [9u8; 32];
    let hash = protocol::commit_hash(&CommitPreimage {
        chain: "testnet",
        game: game.id().as_str(),
        mode: Mode::Solo,
        round: 0,
        actor: bob.id().as_str(),
        entity: Entity::Solo(1),
        guess: &rule,
        salt: &salt,
    });
    let hash = serde_json::to_value(hash)?;
    bob.call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":hash}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let first_commit = snapshot(&game, "first commit").await?;
    check_charge(
        "first commit including entity",
        &before_commit,
        &first_commit,
        record_charge,
        byte_cost,
        &mut failures,
    );
    bob.call(game.id(), "commit_guess")
        .args_json(json!({"mode":0,"hash":hash}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let commits_before_check = snapshot(&game, "repeat commit").await?;
    check_charge(
        "repeat commit",
        &first_commit,
        &commits_before_check,
        record_charge,
        byte_cost,
        &mut failures,
    );
    worker.fast_forward(5).await?;
    let check = bob.call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":0,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":"09".repeat(32)}))
        .gas(Gas::from_tgas(300)).transact_async().await?;
    wait_requests(&mock, 6).await?;
    wait_status(&game, 0, "Checking").await?;
    let checking = snapshot(&game, "guess checking pending").await?;
    peak(
        "guess checking",
        &commits_before_check,
        &checking,
        byte_cost,
    );
    resolve(&mock, 5, Value::Null, true).await?;
    check.await?.into_result()?;
    wait_status(&game, 0, "Refunded").await?;
    let checked = snapshot(&game, "guess refunded").await?;
    if delta(&checked, &commits_before_check) != 0
        || count(&checked, b'p') != count(&commits_before_check, b'p')
    {
        return Err("refunded guess left transient storage behind".into());
    }
    // Two fresh 64-byte accounts acquire maximum-width previous plays before
    // simultaneously holding a verdict and three guess checks apiece.
    let mut players = Vec::new();
    let mut request = 6u32;
    for (index, letter) in [(2u32, "a"), (3, "b")] {
        let player = root
            .create_subaccount(&letter.repeat(name.len()))
            .initial_balance(NearToken::from_near(10))
            .transact()
            .await?
            .into_result()?;
        assert_eq!(player.id().as_str().len(), 64);
        let before = snapshot(&game, "overlap account before").await?;
        player
            .call(game.id(), "deposit_credit")
            .deposit(NearToken::from_near(2))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let deposited = snapshot(&game, "overlap account deposited").await?;
        check_charge(
            "overlap account",
            &before,
            &deposited,
            account_charge,
            byte_cost,
            &mut failures,
        );
        let play = player
            .call(game.id(), "play")
            .args_json(json!({"mode":0,"number":997-index,"word":"nonce"}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        wait_requests(&mock, request + 1).await?;
        resolve(&mock, request, json!({"v":1}), false).await?;
        request += 1;
        play.await?.into_result()?;
        wait_log(&game, index as usize + 2).await?;
        let settled = wait_no_pending(&game, "overlap previous YES settled").await?;
        check_charge(
            "overlap initial YES",
            &deposited,
            &settled,
            record_charge,
            byte_cost,
            &mut failures,
        );
        players.push(player);
    }
    for (i, player) in players.iter().enumerate() {
        for j in 0..3u32 {
            let salt = [20 + i as u8 * 3 + j as u8; 32];
            let hash = protocol::commit_hash(&CommitPreimage {
                chain: "testnet",
                game: game.id().as_str(),
                mode: Mode::Solo,
                round: 0,
                actor: player.id().as_str(),
                entity: Entity::Solo(2 + i as u32),
                guess: &rule,
                salt: &salt,
            });
            let before = snapshot(&game, "overlap commit before").await?;
            let owner_credit = credit(&game, player).await?;
            player
                .call(game.id(), "commit_guess")
                .args_json(json!({"mode":0,"hash":serde_json::to_value(hash)?}))
                .max_gas()
                .transact()
                .await?
                .into_result()?;
            let after = snapshot(&game, "overlap commit retained").await?;
            check_charge(
                "overlap individual commit",
                &before,
                &after,
                record_charge,
                byte_cost,
                &mut failures,
            );
            if owner_credit - credit(&game, player).await?
                != 100_000_000_000_000_000_000_000 + record_charge
            {
                return Err("commit owner debit differs from stake plus record charge".into());
            }
        }
    }
    worker.fast_forward(5).await?;
    let before_overlap = snapshot(&game, "before simultaneous plays and checks").await?;
    let owner_credits = [
        credit(&game, &players[0]).await?,
        credit(&game, &players[1]).await?,
    ];
    let reserve_before: Value = game.view("get_ledger").await?.json()?;
    let mut plays = Vec::new();
    for (i, player) in players.iter().enumerate() {
        plays.push(
            player
                .call(game.id(), "play")
                .args_json(json!({"mode":0,"number":998-i,"word":"nonce"}))
                .gas(Gas::from_tgas(300))
                .transact_async()
                .await?,
        );
        wait_requests(&mock, request + 1).await?;
        request += 1;
    }
    let mut checks = Vec::new();
    for (i, player) in players.iter().enumerate() {
        for j in 0..3u32 {
            let seq = 2 + i as u32 * 3 + j;
            let salt = format!("{:02x}", 20 + i * 3 + j as usize).repeat(32);
            checks.push(player.call(game.id(), "reveal_guess")
                .args_json(json!({"mode":0,"commit_seq":seq,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":salt}))
                .gas(Gas::from_tgas(300)).transact_async().await?);
            wait_requests(&mock, request + 1).await?;
            wait_status(&game, seq as usize, "Checking").await?;
            request += 1;
        }
    }
    let overlap = snapshot(&game, "two verdicts and six Checking guesses").await?;
    assert_eq!(count(&overlap, b'p') - count(&before_overlap, b'p'), 8);
    let mut verdict_sizes = Vec::new();
    let mut guess_sizes = Vec::new();
    for (key, value) in game.view_state().await? {
        if key.first() == Some(&b'p') {
            let bytes = key.len() + value.len() + RECORD_OVERHEAD;
            match value.first() {
                Some(1) => verdict_sizes.push(bytes),
                Some(3) => guess_sizes.push(bytes),
                _ => return Err("unexpected overlap request variant".into()),
            }
        }
    }
    if verdict_sizes.len() != 2
        || guess_sizes.len() != 6
        || verdict_sizes
            .iter()
            .any(|size| *size > verdict_record_bound)
        || guess_sizes.iter().any(|size| *size != guess_record_bound)
    {
        return Err("overlap request records violate the analytical sizes".into());
    }
    println!("OVERLAP actual trie-record bytes: verdict={verdict_sizes:?}, guess={guess_sizes:?}");
    let growth = delta(&overlap, &before_overlap);
    println!(
        "OVERLAP two verdicts and six checks: {growth} B; gross collateral={} yocto",
        growth.max(0) as u128 * byte_cost
    );
    println!(
        "RESERVE: byte_cost * max(0, base and round bytes + retained bytes + pending bytes - retained-charge bytes). Observed get_params: tracked referee cap={referee_cap}, user admission limit={user_limit} (new play/guess requires a tracked total below this limit). The largest referee request-only bound is {verdict_record_bound} B, so {referee_cap} * {verdict_record_bound} = {} B bounds those tracked request records only. Add seen/entity and callback growth; token/payment requests and retained rounds are not bounded by the referee cap. Local expiry also does not bound physical OutLayer work. For all Request variants run cargo run -p game --profile fast --example storage-bounds.",
        u128::from(referee_cap) * verdict_record_bound as u128
    );
    resolve(&mock, 8, json!({"v":0}), false).await?;
    plays.remove(0).await?.into_result()?;
    wait_log(&game, 6).await?;
    for (i, check) in checks.into_iter().enumerate() {
        let correct = i == 5;
        resolve(
            &mock,
            10 + i as u32,
            if correct {
                json!({"correct":true})
            } else {
                Value::Null
            },
            !correct,
        )
        .await?;
        check.await?.into_result()?;
        wait_status(&game, 2 + i, if correct { "Correct" } else { "Refunded" }).await?;
    }
    resolve(&mock, 9, json!({"v":0}), false).await?;
    plays.remove(0).await?.into_result()?;
    let cleared = wait_no_pending(&game, "overlap refunded and settled").await?;
    if count(&cleared, b'p') != count(&before_overlap, b'p') {
        return Err("overlap requests did not clear".into());
    }
    let stake = 100_000_000_000_000_000_000_000u128;
    let fee = 10_000_000_000_000_000_000_000u128;
    if credit(&game, &players[0]).await? != owner_credits[0] - fee - record_charge + 3 * stake
        || credit(&game, &players[1]).await? != owner_credits[1] + 2 * stake
    {
        return Err(
            "overlap owner credits did not reconcile paid/refunded play and guess stakes".into(),
        );
    }
    let reserve_after: Value = game.view("get_ledger").await?.json()?;
    let reserve = |value: &Value| -> Res<u128> {
        Ok(value["storage_reserve"]
            .as_str()
            .ok_or("missing storage reserve")?
            .parse()?)
    };
    if reserve(&reserve_after)? != reserve(&reserve_before)? + record_charge {
        return Err("overlap retained storage charge did not reconcile".into());
    }
    let player_growth: i128 = b"sle"
        .iter()
        .map(|prefix| {
            cleared.prefixes.get(prefix).map_or(0, |v| v.1) as i128
                - before_overlap.prefixes.get(prefix).map_or(0, |v| v.1) as i128
        })
        .sum();
    println!(
        "OVERLAP retained={} B, including round freeze; player prefixes={player_growth} B against one paid play charge={record_charge}",
        delta(&cleared, &before_overlap)
    );
    if player_growth.max(0) as u128 * byte_cost > record_charge {
        failures += 1;
    }

    let before_open = snapshot(&game, "round before finalize").await?;
    // A successful finalize may wait for the mock's yielded open to resume.
    // Race that completion against the bounded request poll; never send a
    // second successful finalize while the first one is in flight.
    let mut open_pending = None;
    for _ in 0..90 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        worker.fast_forward(2).await?;
        let attempt = alice
            .call(game.id(), "finalize")
            .args_json(json!({"mode":0}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?;
        let attempt = std::future::IntoFuture::into_future(attempt);
        tokio::pin!(attempt);
        let completed = tokio::select! {
            result = &mut attempt => Some(result?),
            ready = wait_requests(&mock, request + 1) => {
                ready?;
                None
            }
        };
        let completed = match completed {
            Some(result) if !result.is_success() => {
                let error = result.into_result().expect_err("failed finalize");
                if !format!("{error:?}").contains("E50") {
                    return Err(format!("unexpected finalize failure: {error:?}").into());
                }
                continue;
            }
            other => other,
        };
        wait_requests(&mock, request + 1).await?;
        let pending = snapshot(&game, "round open pending").await?;
        resolve(
            &mock,
            request,
            json!({"rule":serde_json::to_value(&rule)?,"salt":"05".repeat(32)}),
            false,
        )
        .await?;
        match completed {
            Some(result) => {
                result.into_result()?;
            }
            None => {
                attempt.await?.into_result()?;
            }
        }
        open_pending = Some(pending);
        break;
    }
    let open_pending = open_pending.ok_or("finalize deadline not reached")?;
    let settled_round = wait_no_pending(&game, "round settled").await?;
    let round_view: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":0}))
        .await?
        .json()?;
    if round_view["phase"] != "Settled" {
        return Err("round did not settle".into());
    }
    println!(
        "ROUND operator growth from finalize: pending={} B, settled={} B; no round charge assumed",
        delta(&open_pending, &before_open),
        delta(&settled_round, &before_open)
    );
    request += 1;
    let begin = alice
        .call(game.id(), "start_round")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, request + 1).await?;
    let next_pending = snapshot(&game, "next round begin pending").await?;
    resolve(
        &mock,
        request,
        begin_value(commitment.as_str().ok_or("bad commitment")?),
        false,
    )
    .await?;
    begin.await?.into_result()?;
    let next_round = wait_no_pending(&game, "next round investigation").await?;
    let next_view: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":1}))
        .await?
        .json()?;
    if next_view["phase"] != "Investigation" {
        return Err("next round did not begin".into());
    }
    println!(
        "ROUND next begin: pending={} B, retained={} B; earlier round retained and operator funds accumulated overhead",
        delta(&next_pending, &settled_round),
        delta(&next_round, &settled_round)
    );
    println!(
        "LIMIT samples are not worst-case proofs; Team, other request variants, full callback peaks and lifetime round cardinality remain unmeasured."
    );
    if failures != 0 {
        return Err(format!(
            "{failures} retained storage charge(s) insufficient; see exact shortfalls above"
        )
        .into());
    }
    println!("All sampled retained growth is covered by the configured charges.");
    Ok(())
}
