use near_workspaces::types::NearToken;
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
        .args_json(json!({"params":params(mock.id().as_str()),"demo":true}))
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
    let duplicate_error = alice
        .call(game.id(), "play")
        .args_json(json!({"mode":0,"number":1,"word":"otter"}))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("pending duplicate must fail");
    assert!(
        format!("{duplicate_error:?}").contains("E12"),
        "{duplicate_error:?}"
    );
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
