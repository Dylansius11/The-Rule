//! Guess flow on the real game wasm with the MOCK OutLayer (never testnet evidence).
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use protocol::{CommitPreimage, Entity, Mode, RuleHex};
use sandbox_tests::{artifact, params};
use serde_json::{Value, json};

type Res<T> = Result<T, Box<dyn std::error::Error>>;
const WINDOW_NS: u64 = 60_000_000_000;

fn begin_value(commit: &str) -> Value {
    json!({"commit":commit,"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}})
}

async fn wait_status(game: &Contract, commit_seq: usize, status: &str) -> Res<()> {
    for _ in 0..50 {
        if commits(game).await?[commit_seq]["status"] == status {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!("commit {commit_seq} never became {status}").into())
}

async fn wait_requests(mock: &Contract, n: u32) -> Res<()> {
    for _ in 0..50 {
        let count: String = mock.view("request_count").await?.json()?;
        if count.parse::<u32>()? >= n {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(format!("mock never saw request {n}").into())
}

async fn resolve(mock: &Contract, id: u32, value: Value, error: bool) -> Res<()> {
    mock.call("resolve")
        .args_json(json!({"id":id,"resolution":{"value":value,"error":error}}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// Deploy mock and game, run `start_round` and deliver a begin result sealed with `commit`; the
/// round ends in Investigation with a `reveal_window_ns` of `window_ns`.
async fn started(
    worker: &Worker<Sandbox>,
    commit: &str,
    window_ns: u64,
) -> Res<(Contract, Contract)> {
    let mock = worker
        .dev_deploy(&std::fs::read(artifact("mock_outlayer"))?)
        .await?;
    mock.call("new").transact().await?.into_result()?;
    let game = worker.dev_deploy(&std::fs::read(artifact("game"))?).await?;
    let mut config = params(mock.id().as_str());
    config["reveal_window_ns"] = json!(window_ns);
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
    for _ in 0..30 {
        let round: Value = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":null}))
            .await?
            .json()?;
        if round["phase"] == "Investigation" {
            return Ok((mock, game));
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err("round never reached Investigation".into())
}

fn commit_hash(
    game: &Contract,
    actor: &Account,
    rule: &rule_core::CanonicalRule,
    salt: [u8; 32],
) -> String {
    let hash = protocol::commit_hash(&CommitPreimage {
        chain: "testnet",
        game: game.id().as_str(),
        mode: Mode::Solo,
        round: 0,
        actor: actor.id().as_str(),
        entity: Entity::Solo(0),
        guess: rule,
        salt: &salt,
    });
    serde_json::to_value(hash)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

async fn commits(game: &Contract) -> Res<Vec<Value>> {
    Ok(game
        .view("get_commits")
        .args_json(json!({"mode":0,"id":0,"from":0,"limit":200}))
        .await?
        .json()?)
}

async fn credit(game: &Contract, who: &Account) -> Res<u128> {
    let player: Value = game
        .view("get_player")
        .args_json(json!({"account":who.id()}))
        .await?
        .json()?;
    Ok(player["credit"].as_str().unwrap().parse()?)
}

#[tokio::test]
async fn commit_reveal_refund_and_freeze_through_the_mock_referee() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let (mock, game) = started(&worker, &"11".repeat(32), WINDOW_NS).await?;
    let alice = worker.dev_create_account().await?;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let (rule, _) = rule_core::sample(b"sandbox-guess");
    let guess = serde_json::to_value(RuleHex(rule.clone()))?;
    let salt = [9u8; 32];
    let salt_hex = "09".repeat(32);
    let hash = commit_hash(&game, &alice, &rule, salt);
    let before = credit(&game, &alice).await?;
    for _ in 0..2 {
        let ack: Value = alice
            .call(game.id(), "commit_guess")
            .args_json(json!({"mode":0,"hash":hash}))
            .max_gas()
            .transact()
            .await?
            .json()?;
        assert_eq!(ack["stake"], "100000000000000000000000");
    }
    // stake 0.1 NEAR + storage charge 0.001 NEAR per commit
    assert_eq!(
        before - credit(&game, &alice).await?,
        2 * (100_000_000_000_000_000_000_000 + 1_000_000_000_000_000_000_000)
    );
    worker.fast_forward(5).await?;

    // A wrong salt is rejected and leaves the commit revealable.
    let error = alice
        .call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":0,"guess":guess,"salt":"00".repeat(32)}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("wrong salt");
    assert!(format!("{error:?}").contains("E19"), "{error:?}");

    // Commit 0: the referee fails, the full stake comes back and the commit is dead.
    let credit_before_reveal = credit(&game, &alice).await?;
    let first = alice
        .call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":0,"guess":guess,"salt":salt_hex}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    resolve(&mock, 1, Value::Null, true).await?;
    first.await?.into_result()?;
    wait_status(&game, 0, "Refunded").await?;
    let c = commits(&game).await?;
    assert_eq!(c[1]["status"], "Committed");
    assert_eq!(
        credit(&game, &alice).await? - credit_before_reveal,
        100_000_000_000_000_000_000_000
    );

    // Commit 1: a correct verdict freezes the round.
    let second = alice
        .call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":1,"guess":guess,"salt":salt_hex}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 3).await?;
    resolve(&mock, 2, json!({"correct":true}), false).await?;
    second.await?.into_result()?;
    wait_status(&game, 1, "Correct").await?;
    let c = commits(&game).await?;
    assert_eq!(c[1]["status"], "Correct");
    let round: Value = game
        .view("get_round")
        .args_json(json!({"mode":0,"id":null}))
        .await?
        .json()?;
    assert_eq!(round["phase"], "Reveal");
    assert!(round["freeze_ns"].is_u64());
    assert_eq!(round["pending_checks"], 0);
    let ledger: Value = game.view("get_ledger").await?.json()?;
    assert_eq!(ledger["open_stakes"], "100000000000000000000000");

    // Frozen: new plays and commits are rejected.
    for (method, args) in [
        ("play", json!({"mode":0,"number":1,"word":"otter"})),
        ("commit_guess", json!({"mode":0,"hash":hash})),
    ] {
        let error = alice
            .call(game.id(), method)
            .args_json(args)
            .max_gas()
            .transact()
            .await?
            .into_result()
            .expect_err("frozen");
        assert!(format!("{error:?}").contains("E10"), "{error:?}");
    }
    Ok(())
}

#[tokio::test]
async fn solved_round_opens_settles_and_pays_through_the_mock_referee() -> Res<()> {
    let worker = near_workspaces::sandbox().await?;
    let (rule, _) = rule_core::sample(b"sandbox-settle");
    let round_salt = [5u8; 32];
    let commit = serde_json::to_value(protocol::round_commitment(&rule, &round_salt))?;
    let (mock, game) = started(&worker, commit.as_str().unwrap(), 3_000_000_000).await?;
    let alice = worker.dev_create_account().await?;
    alice
        .call(game.id(), "deposit_credit")
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
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
    let reveal = alice
        .call(game.id(), "reveal_guess")
        .args_json(json!({"mode":0,"commit_seq":0,"guess":serde_json::to_value(RuleHex(rule.clone()))?,"salt":"09".repeat(32)}))
        .gas(Gas::from_tgas(300))
        .transact_async()
        .await?;
    wait_requests(&mock, 2).await?;
    resolve(&mock, 1, json!({"correct":true}), false).await?;
    reveal.await?.into_result()?;
    wait_status(&game, 0, "Correct").await?;

    // Nobody can open before the reveal window (3 s) is over.
    let early = alice
        .call(game.id(), "finalize")
        .args_json(json!({"mode":0}))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?
        .into_result()
        .expect_err("window still open");
    assert!(format!("{early:?}").contains("E50"), "{early:?}");
    let mut request = None;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        worker.fast_forward(2).await?;
        let attempt = alice
            .call(game.id(), "finalize")
            .args_json(json!({"mode":0}))
            .gas(Gas::from_tgas(300))
            .transact_async()
            .await?
            .await?;
        if let Ok(done) = attempt.into_result() {
            request = done.json::<Option<u64>>()?;
            break;
        }
    }
    assert_eq!(request.expect("finalize never completed"), 2);
    // The mock numbers its requests in arrival order: begin 0, guess 1, open 2.
    wait_requests(&mock, 3).await?;
    let opened = json!({"rule":serde_json::to_value(&rule)?,"salt":"05".repeat(32)});
    resolve(&mock, 2, opened, false).await?;
    let mut round = Value::Null;
    for _ in 0..30 {
        round = game
            .view("get_round")
            .args_json(json!({"mode":0,"id":null}))
            .await?
            .json()?;
        if round["phase"] == "Settled" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert_eq!(round["phase"], "Settled", "{round}");
    assert_eq!(round["open_status"], "ok");
    assert_eq!(round["rule"], serde_json::to_value(&rule)?);
    assert_eq!(round["salt"], "05".repeat(32));
    assert_eq!(round["outcome"]["account"], alice.id().as_str());

    // The solver gets the stake back; the pot was empty, so there is nothing else to pay.
    let before = credit(&game, &alice).await?;
    let paid: String = alice
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .json()?;
    assert_eq!(paid, "100000000000000000000000");
    assert_eq!(
        credit(&game, &alice).await? - before,
        100_000_000_000_000_000_000_000
    );
    let ledger: Value = game.view("get_ledger").await?.json()?;
    assert_eq!(ledger["open_stakes"], "0");
    assert_eq!(ledger["claimable"], "0");
    let again = alice
        .call(game.id(), "claim")
        .args_json(json!({"mode":0,"round_id":0}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("second claim");
    assert!(format!("{again:?}").contains("E56"), "{again:?}");
    Ok(())
}
