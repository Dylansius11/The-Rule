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
