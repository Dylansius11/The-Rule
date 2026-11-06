mod common;

use common::*;
use near_sdk::{
    Gas, NearToken, PromiseResult,
    serde_json::{self, json},
    testing_env,
};
use protocol::Mode;

fn mint(fx: &mut Fx) -> u64 {
    let register = fx.game.register_token();
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(br#"{"total":"1000","available":"0"}"#.to_vec()),
    );
    fx.game.on_register(register);
    let play = fx.play(12, "otter");
    fx.verdict(play, 1);
    calls().into_iter().find(|c| c.1 == "on_mint").unwrap().2["request_id"]
        .as_u64()
        .unwrap()
}

fn deliver_mint(fx: &mut Fx, id: u64, result: PromiseResult) {
    deliver_env(&fx.ctx, result);
    fx.game.on_mint(id);
}

#[test]
fn unknown_acknowledgements_and_overlapping_retries_preserve_reservation() {
    let mut fx = fixture(params());
    let id = mint(&mut fx);
    let operation = fx.game.get_token_operation(id).unwrap();
    let original = json!({"operation":operation,"status":"applied"});
    let mut wrong_id = original.clone();
    wrong_id["operation"]["operation_id"] = json!(id + 1);
    let mut wrong_account = original.clone();
    wrong_account["operation"]["account_id"] = json!("other.near");
    let mut wrong_amount = original.clone();
    wrong_amount["operation"]["amount"] = json!("101");
    let mut wrong_status = original.clone();
    wrong_status["status"] = json!("insufficient_balance");
    let mut extra = original.clone();
    extra["extra"] = json!(true);
    for result in [
        PromiseResult::Failed,
        PromiseResult::Successful(b"null".to_vec()),
        PromiseResult::Successful(b"{".to_vec()),
        PromiseResult::Successful(vec![b' '; 1025]),
        PromiseResult::Successful(serde_json::to_vec(&wrong_id).unwrap()),
        PromiseResult::Successful(serde_json::to_vec(&wrong_account).unwrap()),
        PromiseResult::Successful(serde_json::to_vec(&wrong_amount).unwrap()),
        PromiseResult::Successful(serde_json::to_vec(&wrong_status).unwrap()),
        PromiseResult::Successful(serde_json::to_vec(&extra).unwrap()),
    ] {
        deliver_mint(&mut fx, id, result);
        assert_eq!(fx.game.get_token_operation(id), Some(operation.clone()));
        assert_eq!(fx.round()["allowance_left"], "499900");
    }
    fx.ctx
        .predecessor_account_id("anyone.near".parse().unwrap());
    for _ in 0..2 {
        testing_env!(fx.ctx.build());
        fx.game.retry_token_operation(id);
        let sent = calls();
        assert_eq!(sent[0].0, "token.testnet");
        assert_eq!(sent[0].1, "execute_operation");
        assert_eq!(sent[0].2, json!({"operation":operation}));
        assert_eq!(sent[0].3, 0);
        assert_eq!(sent[1].2["request_id"], id);
    }
    let ack = serde_json::to_vec(&original).unwrap();
    deliver_mint(&mut fx, id, PromiseResult::Successful(ack.clone()));
    assert!(fx.game.get_token_operation(id).is_none());
    deliver_mint(&mut fx, id, PromiseResult::Successful(ack));
    assert_eq!(fx.round()["allowance_left"], "499900");
    assert!(panic_text(|| fx.game.retry_token_operation(id)).contains("E50"));
}

#[test]
fn retry_rejects_low_gas_without_consuming_operation() {
    let mut fx = fixture(params());
    let id = mint(&mut fx);
    let operation = fx.game.get_token_operation(id);
    fx.ctx.prepaid_gas(Gas::from_tgas(20));
    testing_env!(fx.ctx.build());
    assert!(panic_text(|| fx.game.retry_token_operation(id)).contains("E50"));
    assert_eq!(fx.game.get_token_operation(id), operation);
}

#[test]
fn terminal_mint_rejection_after_settlement_and_next_round_restores_old_round_once() {
    let mut fx = fixture(params());
    let id = mint(&mut fx);
    let response = serde_json::to_vec(
        &json!({"operation":fx.game.get_token_operation(id).unwrap(),"status":"cap_exceeded"}),
    )
    .unwrap();
    fx.run_to_finalize(20);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    fx.at(50, 86_400_000_000_000);
    fx.game.start_round(Mode::Solo);
    deliver_mint(&mut fx, id, PromiseResult::Successful(response.clone()));
    let old = serde_json::to_value(fx.game.get_round(Mode::Solo, Some(0)).unwrap()).unwrap();
    assert_eq!(old["allowance_left"], "500000");
    assert_eq!(
        serde_json::to_value(&fx.game.get_log(Mode::Solo, 0, 0, 1)[0]).unwrap()["minted"],
        "0"
    );
    deliver_mint(&mut fx, id, PromiseResult::Successful(response));
    let old = serde_json::to_value(fx.game.get_round(Mode::Solo, Some(0)).unwrap()).unwrap();
    assert_eq!(old["allowance_left"], "500000");
}

#[test]
fn unlock_unknown_then_terminal_rejection_restores_lock_once() {
    let mut fx = fixture(params());
    fx.ctx
        .predecessor_account_id("token.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    assert_eq!(
        fx.game
            .ft_on_transfer(
                "bob.near".parse().unwrap(),
                near_sdk::json_types::U128(123),
                json!({"lock":{"mode":0,"round_id":1}}).to_string()
            )
            .0,
        0
    );
    fx.ctx
        .predecessor_account_id("bob.near".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1));
    fx.at(20, 2 * 86_400_000_000_000);
    fx.game.unlock(Mode::Solo, 1);
    let id = calls().into_iter().find(|c| c.1 == "on_unlock").unwrap().2["request_id"]
        .as_u64()
        .unwrap();
    let response = serde_json::to_vec(&json!({"operation":fx.game.get_token_operation(id).unwrap(),"status":"receiver_unregistered"})).unwrap();
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_unlock(id);
    assert_eq!(
        fx.game
            .get_lock(Mode::Solo, 1, "bob.near".parse().unwrap())
            .0,
        0
    );
    let operation = fx.game.get_token_operation(id).unwrap();
    let mut wrong_status = json!({"operation":operation,"status":"cap_exceeded"});
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(serde_json::to_vec(&wrong_status).unwrap()),
    );
    fx.game.on_unlock(id);
    wrong_status["status"] = json!("applied");
    wrong_status["operation"]["kind"] = json!("mint");
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(serde_json::to_vec(&wrong_status).unwrap()),
    );
    fx.game.on_unlock(id);
    assert!(fx.game.get_token_operation(id).is_some());
    fx.ctx
        .predecessor_account_id("anyone.near".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(0));
    for _ in 0..2 {
        testing_env!(fx.ctx.build());
        fx.game.retry_token_operation(id);
        let sent = calls();
        assert_eq!(sent[0].2, json!({"operation":operation}));
        assert_eq!(sent[0].3, 0);
    }
    assert!(fx.game.get_token_operation(id).is_some());
    deliver_env(&fx.ctx, PromiseResult::Successful(response.clone()));
    fx.game.on_unlock(id);
    assert_eq!(
        fx.game
            .get_lock(Mode::Solo, 1, "bob.near".parse().unwrap())
            .0,
        123
    );
    deliver_env(&fx.ctx, PromiseResult::Successful(response));
    fx.game.on_unlock(id);
    assert_eq!(
        fx.game
            .get_lock(Mode::Solo, 1, "bob.near".parse().unwrap())
            .0,
        123
    );
}
