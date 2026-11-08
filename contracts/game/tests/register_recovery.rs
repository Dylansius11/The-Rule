mod common;

use common::*;
use near_sdk::{PromiseResult, testing_env};

const TIMEOUT: u64 = 600_000_000_000;
const REGISTERED: &[u8] = br#"{"total":"1000","available":"0"}"#;

fn token_state(fx: &Fx, account: &str) -> String {
    fx.game.get_token_state(account.parse().unwrap())
}

#[test]
fn expired_read_only_registration_can_retry_without_late_callback_overwriting_it() {
    let mut fx = fixture(params());
    let owner = fx.me();
    let money = fx.money();
    let credit = fx.credit();
    let referee_count = fx.ledger()["pending_referee_requests"].clone();
    let request = fx.game.register_token();
    assert_eq!(token_state(&fx, &owner), "pending");
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_withdraw(request);
    assert_eq!(token_state(&fx, &owner), "pending");
    fx.at(10, TIMEOUT - 1);
    assert!(
        panic_text(|| {
            fx.game.expire_request(request);
        })
        .contains("E50")
    );
    assert_eq!(token_state(&fx, &owner), "pending");
    assert_eq!(fx.credit(), credit);

    fx.at(11, TIMEOUT);
    fx.ctx
        .predecessor_account_id("helper.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    assert!(fx.game.expire_request(request));
    assert_eq!(token_state(&fx, &owner), "none");
    assert_eq!(fx.money(), money);
    assert_eq!(credit_of(&fx.game, &owner), credit);
    assert_eq!(fx.ledger()["pending_referee_requests"], referee_count);
    assert!(!fx.game.expire_request(request));

    fx.actor(&owner);
    let replacement = fx.game.register_token();
    deliver_env(&fx.ctx, PromiseResult::Successful(REGISTERED.to_vec()));
    fx.game.on_register(request);
    assert_eq!(token_state(&fx, &owner), "pending");
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_register(request);
    assert_eq!(token_state(&fx, &owner), "pending");
    deliver_env(&fx.ctx, PromiseResult::Successful(REGISTERED.to_vec()));
    fx.game.on_register(replacement);
    assert_eq!(token_state(&fx, &owner), "registered");
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_register(request);
    fx.game.on_register(replacement);
    assert_eq!(token_state(&fx, &owner), "registered");
    assert_eq!(fx.credit(), credit);
    assert_eq!(fx.money(), money);
}

#[test]
fn completed_registration_wins_expiry_race_and_expiring_refresh_requires_a_new_check() {
    let mut fx = fixture(params());
    let owner = fx.me();
    let request = fx.game.register_token();
    fx.at(10, TIMEOUT);
    deliver_env(&fx.ctx, PromiseResult::Successful(REGISTERED.to_vec()));
    fx.game.on_register(request);
    assert!(!fx.game.expire_request(request));
    assert_eq!(token_state(&fx, &owner), "registered");

    let refresh = fx.game.register_token();
    let ledger = fx.ledger();
    fx.at(11, 2 * TIMEOUT);
    assert!(fx.game.expire_request(refresh));
    assert_eq!(token_state(&fx, &owner), "none");
    assert_eq!(fx.ledger(), ledger);
    let verdict = fx.play(2, "otter");
    fx.verdict(verdict, 1);
    let row =
        near_sdk::serde_json::to_value(&fx.game.get_log(protocol::Mode::Solo, 0, 0, 1)[0]).unwrap();
    assert_eq!(row["verdict"], true);
    assert_eq!(row["minted"], "0");
    assert_eq!(fx.round()["allowance_left"], "500000");
    assert!(
        calls()
            .iter()
            .all(|(_, method, _, _)| method != "execute_operation")
    );
}
