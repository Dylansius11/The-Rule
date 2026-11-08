mod common;

use common::*;
use game::Game;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{NearToken, PromiseResult, testing_env};
use protocol::params::{Amount, LockTier};
use protocol::{Mode, Params};

fn tiered() -> Params {
    let mut p = params();
    p.base_attempts = [1, 50];
    p.lock_tiers = vec![
        LockTier {
            amount: Amount(10),
            extra_attempts: 1,
        },
        LockTier {
            amount: Amount(100),
            extra_attempts: 3,
        },
        LockTier {
            amount: Amount(1_000),
            extra_attempts: 200,
        },
    ];
    p
}

fn msg(mode: u8, round: u32) -> String {
    json!({"lock":{"mode":mode,"round_id":round}}).to_string()
}

/// Deliver a token transfer to the game as the token contract; returns the unused amount.
fn token_transfer(
    game: &mut Game,
    ctx: &mut VMContextBuilder,
    sender: &str,
    amount: u128,
    msg: &str,
) -> u128 {
    let caller = ctx.build().predecessor_account_id;
    ctx.predecessor_account_id("token.testnet".parse().unwrap());
    testing_env!(ctx.build());
    let unused = game.ft_on_transfer(sender.parse().unwrap(), U128(amount), msg.to_owned());
    ctx.predecessor_account_id(caller);
    testing_env!(ctx.build());
    unused.0
}

fn lock_for(fx: &mut Fx, amount: u128, round: u32) -> u128 {
    token_transfer(
        &mut fx.game,
        &mut fx.ctx,
        "bob.near",
        amount,
        &msg(0, round),
    )
}

fn locked(fx: &Fx, round: u32) -> u128 {
    fx.game
        .get_lock(Mode::Solo, round, "bob.near".parse().unwrap())
        .0
}

fn limit(fx: &Fx) -> u64 {
    near_sdk::serde_json::to_value(
        fx.game
            .get_entity(Mode::Solo, 0, "bob.near".parse().unwrap()),
    )
    .unwrap()["limit"]
        .as_u64()
        .unwrap()
}

#[test]
fn only_the_token_may_deliver_locks() {
    let mut fx = fixture(params());
    let error = panic_text(|| {
        fx.game
            .ft_on_transfer("bob.near".parse().unwrap(), U128(5), msg(0, 1));
    });
    assert!(error.contains("E40"), "{error}");
}

#[test]
fn a_lock_for_the_next_round_is_kept_and_accumulates() {
    let mut fx = fixture(params());
    // Round 0 is in Investigation, so round 1 is the lockable one.
    assert_eq!(lock_for(&mut fx, 600, 1), 0);
    assert_eq!(lock_for(&mut fx, 400, 1), 0);
    assert_eq!(locked(&fx, 1), 1_000);
    assert_eq!(locked(&fx, 0), 0);
}

#[test]
fn unfunded_accounts_cannot_allocate_lock_storage() {
    let mut fx = fixture(params());
    let ledger = fx.ledger();
    for i in 0..32 {
        let sender = format!("dust-{i}.testnet");
        assert_eq!(
            token_transfer(&mut fx.game, &mut fx.ctx, &sender, 1, &msg(0, 1)),
            1,
            "an unregistered sender must receive every token back"
        );
        assert_eq!(
            fx.game.get_lock(Mode::Solo, 1, sender.parse().unwrap()).0,
            0
        );
    }
    assert_eq!(fx.ledger(), ledger);
}

#[test]
fn a_new_lock_charges_storage_once_and_rejects_insufficient_credit() {
    let p = params();
    let fee = p.storage_charge_per_play.0;
    let mut fx = fixture(p);
    let credit = fx.credit();
    let reserve = fx.term("storage_reserve");
    let money = fx.money();
    assert_eq!(lock_for(&mut fx, 1, 1), 0);
    assert_eq!(fx.credit(), credit - fee);
    assert_eq!(fx.term("storage_reserve"), reserve + fee);
    assert_eq!(fx.money(), money);
    assert_eq!(lock_for(&mut fx, 2, 1), 0);
    assert_eq!(locked(&fx, 1), 3);
    assert_eq!(fx.credit(), credit - fee, "top-ups reuse their storage");

    fx.ctx
        .predecessor_account_id("empty.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(params().storage_charge_account.0));
    testing_env!(fx.ctx.build());
    fx.game.deposit_credit();
    let ledger = fx.ledger();
    assert_eq!(
        token_transfer(&mut fx.game, &mut fx.ctx, "empty.testnet", 1, &msg(0, 1)),
        1
    );
    assert_eq!(
        fx.game
            .get_lock(Mode::Solo, 1, "empty.testnet".parse().unwrap())
            .0,
        0
    );
    assert_eq!(fx.ledger(), ledger);
}

#[test]
fn every_other_message_returns_the_full_amount() {
    let mut fx = fixture(params());
    for (amount, text) in [
        (50, msg(0, 0)), // round already in Investigation
        (50, msg(0, 7)), // far future
        (50, msg(1, 1)), // team mode not supported yet
        (50, "not json".into()),
        (50, json!({"lock":{"mode":0}}).to_string()),
        (50, json!({"unlock":{}}).to_string()),
        (0, msg(0, 1)),
    ] {
        let unused = token_transfer(&mut fx.game, &mut fx.ctx, "bob.near", amount, &text);
        assert_eq!(unused, amount, "{text}");
    }
    assert_eq!(locked(&fx, 0) + locked(&fx, 1) + locked(&fx, 7), 0);
}

/// Attempt limit of bob in round 0 after locking each amount, in order, before the round starts.
fn limit_after_locks(amounts: &[u128]) -> u64 {
    let fx = locked_fixture(amounts);
    limit(&fx)
}

fn locked_fixture(amounts: &[u128]) -> Fx {
    fixture_with(tiered(), 0, "rare", |game, ctx| {
        for amount in amounts {
            assert_eq!(
                token_transfer(game, ctx, "bob.near", *amount, &msg(0, 0)),
                0
            );
        }
    })
}

#[test]
fn the_highest_tier_reached_raises_the_attempt_limit_up_to_the_cap() {
    assert_eq!(limit_after_locks(&[]), 1, "no lock");
    assert_eq!(limit_after_locks(&[9]), 1, "9 is below the first tier");
    assert_eq!(limit_after_locks(&[10]), 2);
    assert_eq!(
        limit_after_locks(&[60, 40]),
        4,
        "60 + 40 reaches the second tier"
    );
    assert_eq!(limit_after_locks(&[5_000]), 125, "capped at attempt_cap");
}

#[test]
fn a_lock_for_another_round_does_not_change_this_round() {
    let mut fx = fixture(tiered());
    assert_eq!(lock_for(&mut fx, 1_000, 1), 0);
    assert_eq!(limit(&fx), 1);
}

#[test]
fn the_extra_attempt_is_playable_and_the_next_one_is_not() {
    let mut fx = locked_fixture(&[10]);
    for number in [2, 3] {
        let request = fx.play(number, "otter");
        fx.verdict(request, 0);
    }
    let error = panic_text(|| {
        fx.game.play(Mode::Solo, 4, "otter".into());
    });
    assert!(error.contains("E14"), "{error}");
}

#[test]
fn unlock_needs_one_yocto_a_lock_and_a_finished_round() {
    let mut fx = fixture(params());
    assert_eq!(lock_for(&mut fx, 500, 1), 0);
    let no_deposit = panic_text(|| fx.game.unlock(Mode::Solo, 1));
    assert!(no_deposit.contains("E51"), "{no_deposit}");
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    let early = panic_text(|| fx.game.unlock(Mode::Solo, 1));
    assert!(early.contains("E10"), "round 1 may still start: {early}");
    let none = panic_text(|| fx.game.unlock(Mode::Solo, 0));
    assert!(none.contains("E56"), "{none}");
    assert_eq!(locked(&fx, 1), 500);
}

#[test]
fn a_round_that_never_started_releases_its_locks_one_period_after_its_slot() {
    let mut fx = fixture(params());
    assert_eq!(lock_for(&mut fx, 500, 1), 0);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    // Slot of round 1 is one period; released after a second full period.
    let period = 86_400_000_000_000u64;
    fx.at(50, 2 * period);
    fx.game.unlock(Mode::Solo, 1);
    assert_eq!(locked(&fx, 1), 0);
    let sent = calls();
    assert_eq!(
        sent[0],
        (
            "token.testnet".to_owned(),
            "execute_operation".to_owned(),
            json!({"operation":{"operation_id":1,"kind":"unlock","account_id":"bob.near","amount":"500"}}),
            0
        )
    );
    // The transfer failed (for instance the receiver unregistered): the lock comes back.
    deliver_env(&fx.ctx, token_ack(&fx.game, 1, "receiver_unregistered"));
    fx.game.on_unlock(1);
    assert_eq!(locked(&fx, 1), 500);
    // A second unlock goes through and its success callback releases for good.
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    fx.at(51, 2 * period);
    fx.game.unlock(Mode::Solo, 1);
    deliver_env(&fx.ctx, token_ack(&fx.game, 2, "applied"));
    fx.game.on_unlock(2);
    assert_eq!(locked(&fx, 1), 0);
    // A duplicate callback restores nothing.
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_unlock(2);
    assert_eq!(locked(&fx, 1), 0);
}

#[test]
fn failed_unlock_restores_tokens_into_a_paid_replacement_lock() {
    let mut fx = fixture(params());
    assert_eq!(lock_for(&mut fx, 500, 1), 0);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    fx.at(50, 2 * 86_400_000_000_000);
    fx.game.unlock(Mode::Solo, 1);
    let credit = fx.credit();
    let reserve = fx.term("storage_reserve");
    // The old transfer is still in flight; a new key must pay for its own storage.
    assert_eq!(lock_for(&mut fx, 7, 1), 0);
    let fee = params().storage_charge_per_play.0;
    assert_eq!(fx.credit(), credit - fee);
    assert_eq!(fx.term("storage_reserve"), reserve + fee);
    deliver_env(&fx.ctx, token_ack(&fx.game, 1, "insufficient_balance"));
    fx.game.on_unlock(1);
    assert_eq!(locked(&fx, 1), 507);
    assert_eq!(
        fx.credit(),
        credit - fee,
        "restoration must not charge again"
    );
    assert_eq!(fx.term("storage_reserve"), reserve + fee);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_unlock(1);
    assert_eq!(
        locked(&fx, 1),
        507,
        "duplicate callbacks cannot restore twice"
    );
}

#[test]
fn locks_are_returned_after_a_settled_round() {
    let mut fx = fixture_with(params(), 0, "rare", |game, ctx| {
        assert_eq!(token_transfer(game, ctx, "bob.near", 250, &msg(0, 0)), 0);
    });
    assert_eq!(locked(&fx, 0), 250);
    fx.run_to_finalize(10);
    let (_, open) = fx.finalize_all();
    let still = panic_text(|| {
        fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(fx.ctx.build());
        fx.game.unlock(Mode::Solo, 0);
    });
    assert!(still.contains("E10"), "Opening is not over yet: {still}");
    let result = fx.open_ok();
    fx.on_open(open, result);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    fx.game.unlock(Mode::Solo, 0);
    assert_eq!(locked(&fx, 0), 0);
    assert_eq!(calls()[0].1, "execute_operation");
}
