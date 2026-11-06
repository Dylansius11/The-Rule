mod common;

use common::*;
use near_sdk::PromiseResult;
use near_sdk::serde_json::{Value, json};
use protocol::Mode;

const REGISTERED: &[u8] = br#"{"total":"1000","available":"0"}"#;

/// Deliver the token's successful storage balance response.
fn register(fx: &mut Fx) {
    let request = fx.game.register_token();
    deliver_env(&fx.ctx, PromiseResult::Successful(REGISTERED.to_vec()));
    fx.game.on_register(request);
}

fn minted_of_row(fx: &Fx, idx: u32) -> Value {
    let rows = fx.game.get_log(Mode::Solo, 0, idx, 1);
    near_sdk::serde_json::to_value(&rows[0]).unwrap()["minted"].clone()
}

/// One ACCEPT; returns the verdict request id (the mint request id is the next one).
fn accept(fx: &mut Fx, number: u16) -> u64 {
    let request = fx.play(number, "otter");
    fx.verdict(request, 1);
    request
}

#[test]
fn existing_token_registration_does_not_debit_game_credit() {
    let mut fx = fixture(params());
    let (credit, money) = (fx.credit(), fx.money());
    let request = fx.game.register_token();
    assert_eq!(fx.credit(), credit);
    assert_eq!(fx.term("pending_credit"), 0);
    assert_eq!(
        fx.game.get_token_state("bob.near".parse().unwrap()),
        "pending"
    );
    assert_eq!(
        calls()[0],
        (
            "token.testnet".to_owned(),
            "storage_balance_of".to_owned(),
            json!({"account_id":"bob.near"}),
            0
        )
    );
    let pending_error = panic_text(|| {
        fx.game.register_token();
    });
    assert!(pending_error.contains("E57"), "{pending_error}");
    deliver_env(&fx.ctx, PromiseResult::Successful(REGISTERED.to_vec()));
    fx.game.on_register(request);
    assert_eq!(
        fx.game.get_token_state("bob.near".parse().unwrap()),
        "registered"
    );
    assert_eq!(fx.credit(), credit);
    assert_eq!(fx.money(), money);
    let refresh = fx.game.register_token();
    deliver_env(&fx.ctx, PromiseResult::Successful(REGISTERED.to_vec()));
    fx.game.on_register(refresh);
    assert_eq!(
        fx.game.get_token_state("bob.near".parse().unwrap()),
        "registered"
    );
    assert_eq!(fx.credit(), credit);
}

#[test]
fn null_malformed_and_failed_registration_checks_leave_no_credit_change() {
    let mut fx = fixture(params());
    let (credit, money) = (fx.credit(), fx.money());
    for result in [
        PromiseResult::Successful(b"null".to_vec()),
        PromiseResult::Successful(Vec::new()),
        PromiseResult::Successful(br#"{"total":"1000"}"#.to_vec()),
        PromiseResult::Successful(br#"{"total":1000,"available":"0"}"#.to_vec()),
        PromiseResult::Successful(br#"{"total":"1","available":"2"}"#.to_vec()),
        PromiseResult::Successful(br#"{"total":"1","available":"0","extra":true}"#.to_vec()),
        PromiseResult::Failed,
    ] {
        let request = fx.game.register_token();
        deliver_env(&fx.ctx, result);
        fx.game.on_register(request);
        assert_eq!(fx.game.get_token_state("bob.near".parse().unwrap()), "none");
        assert_eq!(fx.credit(), credit);
        assert_eq!(fx.money(), money);
        deliver_env(&fx.ctx, PromiseResult::Successful(REGISTERED.to_vec()));
        fx.game.on_register(request);
        assert_eq!(fx.game.get_token_state("bob.near".parse().unwrap()), "none");
    }
    register(&mut fx);
    assert_eq!(
        fx.game.get_token_state("bob.near".parse().unwrap()),
        "registered"
    );
    let refresh = fx.game.register_token();
    deliver_env(&fx.ctx, PromiseResult::Successful(b"null".to_vec()));
    fx.game.on_register(refresh);
    assert_eq!(fx.game.get_token_state("bob.near".parse().unwrap()), "none");
}

#[test]
fn token_check_needs_a_player_but_no_credit() {
    let mut fx = fixture(params());
    fx.ctx.predecessor_account_id("poor.near".parse().unwrap());
    near_sdk::testing_env!(fx.ctx.build());
    let error = panic_text(|| {
        fx.game.register_token();
    });
    assert!(error.contains("E20"), "{error}");
    fx.ctx
        .attached_deposit(near_sdk::NearToken::from_yoctonear(100));
    near_sdk::testing_env!(fx.ctx.build());
    fx.game.deposit_credit();
    assert_eq!(fx.credit(), 0);
    register(&mut fx);
    assert_eq!(fx.credit(), 0);
    assert_eq!(
        fx.game.get_token_state("poor.near".parse().unwrap()),
        "registered"
    );
}

#[test]
fn an_unregistered_player_mints_nothing_and_keeps_the_allowance() {
    let mut fx = fixture(params());
    accept(&mut fx, 2);
    assert!(calls().iter().all(|c| c.0 != "token.testnet"));
    assert_eq!(minted_of_row(&fx, 0), "0");
    assert_eq!(fx.round()["allowance_left"], "500000");
}

#[test]
fn accept_mints_a_decaying_amount_and_no_verdict_mints_nothing() {
    let mut fx = fixture(params());
    register(&mut fx);
    let request = accept(&mut fx, 2);
    assert_eq!(minted_of_row(&fx, 0), "100");
    assert_eq!(fx.round()["allowance_left"], "499900");
    // A NO mints nothing.
    let no_request = fx.play(3, "otter");
    fx.verdict(no_request, 0);
    assert!(calls().iter().all(|c| c.0 != "token.testnet"));
    assert_eq!(minted_of_row(&fx, 1), "0");
    // The next ACCEPT mints less: 100 * 499900 / 500000 = 99.98, floored.
    accept(&mut fx, 4);
    assert_eq!(minted_of_row(&fx, 2), "99");
    assert_eq!(fx.round()["allowance_left"], "499801");
    // A mint that went through stays; its callback changes nothing.
    deliver_env(&fx.ctx, token_ack(&fx.game, request + 1, "applied"));
    fx.game.on_mint(request + 1);
    assert_eq!(minted_of_row(&fx, 0), "100");
    assert_eq!(fx.round()["allowance_left"], "499801");
}

#[test]
fn rarity_scales_the_mint() {
    for (bucket, expected) in [("rare", "100"), ("mid", "50"), ("common", "25")] {
        let mut fx = fixture_with(params(), 0, bucket, |_, _| {});
        register(&mut fx);
        accept(&mut fx, 2);
        assert_eq!(minted_of_row(&fx, 0), expected, "{bucket}");
    }
}

#[test]
fn a_failed_mint_restores_the_allowance_and_zeroes_the_row_once() {
    let mut fx = fixture(params());
    register(&mut fx);
    let request = accept(&mut fx, 2);
    assert_eq!(fx.round()["allowance_left"], "499900");
    deliver_env(&fx.ctx, token_ack(&fx.game, request + 1, "cap_exceeded"));
    fx.game.on_mint(request + 1);
    assert_eq!(fx.round()["allowance_left"], "500000");
    assert_eq!(minted_of_row(&fx, 0), "0");
    // The verdict stands, and a duplicate callback restores nothing twice.
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_mint(request + 1);
    assert_eq!(fx.round()["allowance_left"], "500000");
    let row = near_sdk::serde_json::to_value(&fx.game.get_log(Mode::Solo, 0, 0, 1)[0]).unwrap();
    assert_eq!(row["verdict"], true);
}

#[test]
fn a_verdict_callback_without_gas_for_the_mint_mints_nothing_and_keeps_the_allowance() {
    let mut fx = fixture(params());
    register(&mut fx);
    let request = fx.play(2, "otter");
    // The callback only has 8 Tgas: not enough to also schedule `mint` and `on_mint`.
    fx.ctx.prepaid_gas(near_sdk::Gas::from_tgas(8));
    fx.verdict(request, 1);
    assert!(calls().iter().all(|c| c.0 != "token.testnet"));
    assert_eq!(minted_of_row(&fx, 0), "0");
    assert_eq!(fx.round()["allowance_left"], "500000");
    let row = near_sdk::serde_json::to_value(&fx.game.get_log(Mode::Solo, 0, 0, 1)[0]).unwrap();
    assert_eq!(row["verdict"], true);
}
