mod common;
use common::*;
use game::Game;
use near_sdk::{NearToken, PromiseResult, test_utils::VMContextBuilder, testing_env};
use protocol::Mode;

const TIMEOUT: u64 = 600_000_000_000;

#[test]
fn expired_play_refunds_once_and_cannot_settle_a_replacement() {
    let mut fx = fixture(params());
    let owner = fx.me();
    let before = fx.ledger();
    let request = fx.play(999, "otter");
    let pending_credit = fx.credit();
    fx.at(10, TIMEOUT - 1);
    assert!(
        panic_text(|| {
            fx.game.expire_request(request);
        })
        .contains("E50")
    );
    assert_eq!(fx.credit(), pending_credit);
    fx.at(11, TIMEOUT);
    // Recovery has no owner privilege: a third party can free the original player's credit.
    fx.ctx
        .predecessor_account_id("helper.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    assert!(fx.game.expire_request(request));
    assert_eq!(fx.ledger(), before);
    assert!(!fx.game.expire_request(request));
    assert_eq!(credit_of(&fx.game, &owner), DEPOSIT - 100);
    fx.actor(&owner);
    let replacement = fx.play(999, "otter");
    let pending = fx.ledger();
    fx.verdict(request, 1);
    assert_eq!(fx.ledger(), pending);
    assert!(fx.game.get_log(Mode::Solo, 0, 0, 200).is_empty());
    fx.verdict(replacement, 0);
    assert_eq!(fx.term("round_pots"), 8_000);
    assert_eq!(fx.credit(), DEPOSIT - 100 - 10_100);
}

#[test]
fn expired_guess_refunds_stake_and_unblocks_finalization_without_late_winner() {
    let mut fx = fixture(params());
    fx.commit();
    fx.at(2, 1);
    let request = fx.reveal(0);
    assert_eq!(fx.ledger()["pending_referee_requests"], 1);
    let checking_credit = fx.credit();
    fx.at(3, TIMEOUT + 1);
    assert!(fx.game.expire_request(request));
    assert_eq!(fx.ledger()["pending_referee_requests"], 0);
    assert_eq!(status(&fx.commits()[0]), "Refunded");
    assert_eq!(fx.credit(), checking_credit + 100);
    assert_eq!(fx.round()["pending_checks"], 0);
    assert_eq!(fx.term("open_stakes"), 0);
    let before = fx.ledger();
    fx.answer(request, yes());
    assert_eq!(fx.ledger(), before);
    assert_eq!(fx.round()["phase"], "Investigation");
    assert!(!fx.game.expire_request(request));
    assert!(
        panic_text(|| {
            fx.reveal(0);
        })
        .contains("E10")
    );
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    fx.game.withdraw_credit(near_sdk::json_types::U128(1));
    fx.run_to_finalize(10);
    assert!(fx.game.finalize(Mode::Solo).is_some());
    assert_eq!(fx.round()["outcome"]["kind"], "Unsolved");
}

#[test]
fn begin_expiry_allows_retry_then_timeout_cancel_and_fences_the_old_response() {
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut ctx = VMContextBuilder::new();
    ctx.prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(123));
    testing_env!(ctx.build());
    let mut game = Game::new(params(), true);
    game.seed_pot(Mode::Solo);
    let first = game.start_round(Mode::Solo);
    assert_eq!(
        near_sdk::serde_json::to_value(game.get_ledger()).unwrap()["pending_referee_requests"],
        1
    );
    ctx.block_timestamp(TIMEOUT);
    testing_env!(ctx.build());
    assert!(game.expire_request(first));
    assert_eq!(
        near_sdk::serde_json::to_value(game.get_ledger()).unwrap()["pending_referee_requests"],
        0
    );
    let retry = game.start_round(Mode::Solo);
    assert_eq!(
        near_sdk::serde_json::to_value(game.get_ledger()).unwrap()["pending_referee_requests"],
        1
    );
    let begin = near_sdk::serde_json::json!({"commit":"11".repeat(32),"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
    deliver_env(
        &ctx,
        PromiseResult::Successful(begin.to_string().into_bytes()),
    );
    game.on_begin(first);
    assert_eq!(
        near_sdk::serde_json::to_value(game.get_ledger()).unwrap()["pending_referee_requests"],
        1
    );
    let round = near_sdk::serde_json::to_value(game.get_round(Mode::Solo, None)).unwrap();
    assert_eq!(round["phase"], "Sealing");
    assert_eq!(round["begin_status"], "pending");
    ctx.block_timestamp(INVESTIGATION_END);
    testing_env!(ctx.build());
    assert!(game.expire_request(retry));
    let round = near_sdk::serde_json::to_value(game.get_round(Mode::Solo, None)).unwrap();
    assert_eq!(round["phase"], "Cancelled");
    let ledger = near_sdk::serde_json::to_value(game.get_ledger()).unwrap();
    assert_eq!(ledger["carry"], "123");
    assert_eq!(ledger["round_pots"], "0");
}

#[test]
fn open_expiry_allows_retry_or_cancel_but_not_a_late_settlement() {
    for cancel in [false, true] {
        let mut fx = fixture(params());
        fx.run_to_finalize(10);
        let started = fx.ctx.build().block_timestamp;
        let request = fx.game.finalize(Mode::Solo).unwrap();
        assert_eq!(fx.ledger()["pending_referee_requests"], 1);
        fx.at(11, started + TIMEOUT);
        assert!(fx.game.expire_request(request));
        assert_eq!(fx.ledger()["pending_referee_requests"], 0);
        assert_eq!(fx.round()["open_status"], "failed");
        if cancel {
            fx.at(12, started + params().open_timeout_ns);
            fx.game.cancel(Mode::Solo, 0);
            let result = fx.open_ok();
            fx.on_open(request, result);
            assert_eq!(fx.round()["phase"], "Cancelled");
        } else {
            let retry = fx.game.retry_open(Mode::Solo, 0);
            assert_eq!(fx.ledger()["pending_referee_requests"], 1);
            let result = fx.open_ok();
            fx.on_open(request, result);
            assert_eq!(fx.ledger()["pending_referee_requests"], 1);
            assert_eq!(fx.round()["open_status"], "pending");
            let result = fx.open_ok();
            fx.on_open(retry, result);
            assert_eq!(fx.ledger()["pending_referee_requests"], 0);
            assert_eq!(fx.round()["phase"], "Settled");
            assert!(!fx.game.expire_request(retry));
        }
    }
}

#[test]
fn callback_winning_the_race_prevents_expiry_and_transfer_requests_are_never_expired() {
    let mut fx = fixture(params());
    let request = fx.play(1, "otter");
    fx.at(10, TIMEOUT);
    fx.verdict(request, 0);
    let settled = fx.ledger();
    assert!(!fx.game.expire_request(request));
    assert_eq!(fx.ledger(), settled);
    assert!(!fx.game.expire_request(u64::MAX));
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    fx.game.withdraw_credit(near_sdk::json_types::U128(123));
    let withdraw = calls()
        .into_iter()
        .find(|(_, method, _, _)| method == "on_withdraw")
        .unwrap()
        .2["request_id"]
        .as_u64()
        .unwrap();
    fx.at(20, 10 * TIMEOUT);
    let pending = fx.credit();
    assert!(!fx.game.expire_request(withdraw));
    assert_eq!(fx.credit(), pending);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_withdraw(withdraw);
    assert_eq!(fx.credit(), pending + 123);
}
