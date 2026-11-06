mod common;
use common::*;
use near_sdk::{NearToken, PromiseResult, json_types::U128, testing_env};

#[test]
fn checking_guess_blocks_withdrawal_until_every_check_finishes() {
    let mut fx = fixture(params());
    fx.commit();
    fx.at(2, 1);
    fx.commit();
    fx.at(4, 2);
    let first = fx.reveal(0);
    let second = fx.reveal(1);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    let before = fx.credit();
    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
    assert_eq!(fx.credit(), before);

    fx.answer(first, no());
    testing_env!(fx.ctx.build());
    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
    // A duplicate delivery must not unlock withdrawal while the other check is live.
    fx.answer(first, no());
    testing_env!(fx.ctx.build());
    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
    fx.answer(second, PromiseResult::Failed);
    testing_env!(fx.ctx.build());
    let before = fx.credit();
    fx.game.withdraw_credit(U128(1));
    assert_eq!(fx.credit(), before - 1);
}

#[test]
fn every_guess_outcome_releases_only_its_owners_withdrawal_guard() {
    for response in [yes(), no(), PromiseResult::Failed] {
        let mut fx = fixture(params());
        fx.commit();
        fx.at(2, 1);
        let request = fx.reveal(0);
        let owner = fx.me();
        fx.actor("other.testnet");
        fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(fx.ctx.build());
        let before = fx.credit();
        fx.game.withdraw_credit(U128(1));
        assert_eq!(fx.credit(), before - 1);
        fx.actor(&owner);
        fx.answer(request, response);
        testing_env!(fx.ctx.build());
        let before = fx.credit();
        fx.game.withdraw_credit(U128(1));
        assert_eq!(fx.credit(), before - 1);
    }
}

#[test]
fn failed_withdrawal_restores_credit_once_and_success_keeps_the_debit() {
    for failed in [false, true] {
        let mut fx = fixture(params());
        fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(fx.ctx.build());
        let before = fx.credit();
        fx.game.withdraw_credit(U128(123));
        let request = calls()
            .into_iter()
            .find(|(_, method, _, _)| method == "on_withdraw")
            .unwrap()
            .2["request_id"]
            .as_u64()
            .unwrap();
        assert_eq!(fx.credit(), before - 123);
        let response = || {
            if failed {
                PromiseResult::Failed
            } else {
                PromiseResult::Successful(Vec::new())
            }
        };
        deliver_env(&fx.ctx, response());
        fx.game.on_withdraw(request);
        assert_eq!(fx.credit(), if failed { before } else { before - 123 });
        deliver_env(&fx.ctx, response());
        fx.game.on_withdraw(request);
        assert_eq!(fx.credit(), if failed { before } else { before - 123 });
        // Completion also releases the in-flight transfer guard.
        testing_env!(fx.ctx.build());
        fx.game.withdraw_credit(U128(1));
    }
}

#[test]
fn withheld_withdrawal_does_not_block_play_or_make_its_principal_spendable() {
    let p = params();
    let charge = p.play_fee.0 + p.storage_charge_per_play.0;
    let mut fx = fixture(p);
    let initial = fx.credit();
    let amount = initial - charge;
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    fx.game.withdraw_credit(U128(amount));
    let withdrawal = calls()
        .into_iter()
        .find(|(_, method, _, _)| method == "on_withdraw")
        .unwrap()
        .2["request_id"]
        .as_u64()
        .unwrap();
    assert_eq!(fx.credit(), charge);

    fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(fx.ctx.build());
    let play = fx.play(17, "otter");
    assert_eq!(fx.credit(), 0);
    fx.verdict(play, 0);
    let before = near_sdk::serde_json::to_value(fx.game.get_ledger()).unwrap();
    testing_env!(fx.ctx.build());
    assert!(
        panic_text(|| {
            fx.play(18, "otter");
        })
        .contains("E20")
    );
    assert_eq!(
        near_sdk::serde_json::to_value(fx.game.get_ledger()).unwrap(),
        before
    );

    // A new deposit funds another experiment; it cannot release the old payment.
    fx.ctx.attached_deposit(NearToken::from_yoctonear(charge));
    testing_env!(fx.ctx.build());
    fx.game.deposit_credit();
    fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(fx.ctx.build());
    let next = fx.play(19, "otter");
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_verdict(next);
    assert_eq!(fx.credit(), charge);
    fx.at(10, 600_000_000_000);
    assert!(!fx.game.expire_request(withdrawal));
    assert_eq!(fx.credit(), charge);
    let ledger = near_sdk::serde_json::to_value(fx.game.get_ledger()).unwrap();
    assert_eq!(ledger["pending_native_payments"], amount.to_string());
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
}
