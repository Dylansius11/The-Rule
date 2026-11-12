//! Callback ordering at numeric and account-width boundaries. Native mocks do not model
//! actual receipt balances or establish a gas bound; run the sandbox reporters separately.
mod common;

use common::*;
use near_sdk::{NearToken, PromiseResult, json_types::U128, serde_json::json, testing_env};
use protocol::{Mode, params::Amount};

fn callback_id(method: &str) -> u64 {
    calls().into_iter().find(|c| c.1 == method).unwrap().2["request_id"]
        .as_u64()
        .unwrap()
}

fn deliver(fx: &mut Fx, id: u64, success: bool, callback: fn(&mut game::Game, u64)) {
    let response = if let Some(operation) = fx.game.get_token_operation(id) {
        let status = if success {
            "applied"
        } else if operation.kind == protocol::token::TokenOperationKind::Mint {
            "cap_exceeded"
        } else {
            "insufficient_balance"
        };
        token_ack(&fx.game, id, status)
    } else if success {
        PromiseResult::Successful(Vec::new())
    } else {
        PromiseResult::Failed
    };
    deliver_env(&fx.ctx, response);
    callback(&mut fx.game, id);
}

#[test]
fn immutable_root_configuration_boundaries() {
    let ctx = near_sdk::test_utils::VMContextBuilder::new();
    testing_env!(ctx.build());
    let mut largest = params();
    largest.referee.urls = vec!["x".repeat(2048), "y".repeat(2048)];
    largest.lock_tiers = near_sdk::serde_json::from_value(json!([
        {"amount":"1","extra_attempts":1},
        {"amount":"2","extra_attempts":2},
        {"amount":"3","extra_attempts":3}
    ]))
    .unwrap();
    game::Game::new(largest.clone(), true);
    let mut unicode = largest.clone();
    unicode.referee.urls[0] = "é".repeat(1024);
    game::Game::new(unicode.clone(), true);
    unicode.referee.urls[0].push('é');
    assert!(
        panic_text(|| {
            game::Game::new(unicode, true);
        })
        .contains("E11")
    );
    let mut cases = Vec::new();
    let mut p = largest.clone();
    p.referee.urls[0].push('x');
    cases.push(p);
    let mut p = largest.clone();
    p.referee.urls.push("z".into());
    cases.push(p);
    let mut p = largest.clone();
    p.referee.urls.clear();
    cases.push(p);
    let mut p = largest.clone();
    p.lock_tiers.push(p.lock_tiers[0].clone());
    cases.push(p);
    let mut p = largest;
    p.chain_id = "mainnet".into();
    cases.push(p);
    for p in cases {
        testing_env!(ctx.build());
        assert!(
            panic_text(|| {
                game::Game::new(p, true);
            })
            .contains("E11")
        );
    }
}

#[test]
fn mint_failures_restore_only_their_reservations_at_maximum_allowance() {
    let maximum = (1u128 << 127) - 1;
    let mut p = params();
    p.round_allowance = Amount(maximum);
    p.mint_base = Amount(maximum / 2);
    let mut fx = fixture(p);
    let actor = "a".repeat(64);
    fx.actor(&actor);
    let register = fx.game.register_token();
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(
            br#"{"total":"340282366920938463463374607431768211455","available":"0"}"#.to_vec(),
        ),
    );
    fx.game.on_register(register);
    let first = fx.play(1, "otter");
    fx.verdict(first, 1);
    let mint1 = callback_id("on_mint");
    let reserved1 = maximum / 2;
    let second = fx.play(2, "otter");
    fx.verdict(second, 1);
    let mint2 = callback_id("on_mint");
    let remaining = num(&fx.round()["allowance_left"]);
    let reserved2 = maximum - reserved1 - remaining;
    assert!(reserved2 > 0);
    assert!(!fx.game.expire_request(mint1));
    deliver(&mut fx, mint2, false, game::Game::on_mint);
    assert_eq!(num(&fx.round()["allowance_left"]), remaining + reserved2);
    deliver(&mut fx, mint2, false, game::Game::on_mint);
    assert_eq!(num(&fx.round()["allowance_left"]), remaining + reserved2);
    deliver(&mut fx, mint1, false, game::Game::on_mint);
    assert_eq!(num(&fx.round()["allowance_left"]), maximum);
    let rows = fx.game.get_log(Mode::Solo, 0, 0, 200);
    let rows = near_sdk::serde_json::to_value(rows).unwrap();
    assert_eq!(num(&rows[0]["minted"]), 0);
    assert_eq!(num(&rows[1]["minted"]), 0);
    deliver(&mut fx, mint1, true, game::Game::on_mint);
    assert_eq!(num(&fx.round()["allowance_left"]), maximum);
}

#[test]
fn withdraw_failure_merges_new_credit_once_and_fences_late_success() {
    let mut fx = fixture(params());
    let actor = "b".repeat(64);
    fx.actor(&actor);
    // Model each receipt's balance before its attached deposit. The withdrawal's
    // one yocto also consumes headroom; the failed transfer returns its principal.
    let before_top_up = fx.term("credit") + fx.term("storage_reserve");
    let top_up = u128::MAX - before_top_up - 987_655;
    fx.ctx
        .account_balance(NearToken::from_yoctonear(before_top_up))
        .attached_deposit(NearToken::from_yoctonear(top_up));
    testing_env!(fx.ctx.build());
    fx.game.deposit_credit();
    let initial = fx.credit();
    fx.ctx
        .account_balance(NearToken::from_yoctonear(u128::MAX - 987_655))
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    fx.game.withdraw_credit(U128(initial));
    let id = callback_id("on_withdraw");
    assert!(!fx.game.expire_request(id));
    fx.ctx
        .account_balance(NearToken::from_yoctonear(u128::MAX - 987_654 - initial))
        .attached_deposit(NearToken::from_yoctonear(987_654));
    testing_env!(fx.ctx.build());
    fx.game.deposit_credit();
    assert_eq!(fx.credit(), 987_654);
    fx.ctx
        .account_balance(NearToken::from_yoctonear(u128::MAX))
        .attached_deposit(NearToken::from_yoctonear(0));
    deliver(&mut fx, id, false, game::Game::on_withdraw);
    assert_eq!(fx.credit(), initial + 987_654);
    deliver(&mut fx, id, true, game::Game::on_withdraw);
    assert_eq!(fx.credit(), initial + 987_654);
}

#[test]
fn platform_failure_merges_new_accrual_once() {
    let mut fx = fixture(params());
    let first = fx.play(1, "otter");
    fx.verdict(first, 0);
    let accrued = fx.term("platform_accrued");
    let id = fx.game.claim_platform();
    assert!(!fx.game.expire_request(id));
    let second = fx.play(2, "otter");
    fx.verdict(second, 0);
    assert_eq!(fx.term("platform_accrued"), accrued);
    deliver(&mut fx, id, false, game::Game::on_platform);
    assert_eq!(fx.term("platform_accrued"), 2 * accrued);
    deliver(&mut fx, id, false, game::Game::on_platform);
    assert_eq!(fx.term("platform_accrued"), 2 * accrued);
}

#[test]
fn unlock_failure_restores_maximum_principal_without_touching_next_slot() {
    let mut fx = fixture(params());
    let actor = "c".repeat(64);
    fx.actor(&actor);
    let old = u128::MAX / 2;
    let replacement = u128::MAX - old;
    let msg = json!({"lock":{"mode":0,"round_id":1}}).to_string();
    fx.ctx
        .predecessor_account_id("token.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    assert_eq!(
        fx.game
            .ft_on_transfer(actor.parse().unwrap(), U128(old), msg)
            .0,
        0
    );
    fx.ctx
        .predecessor_account_id(actor.parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1));
    fx.at(10, 2 * 86_400_000_000_000);
    fx.game.unlock(Mode::Solo, 1);
    let id = callback_id("on_unlock");
    assert!(!fx.game.expire_request(id));
    fx.ctx
        .predecessor_account_id("token.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    assert_eq!(
        fx.game
            .ft_on_transfer(
                actor.parse().unwrap(),
                U128(replacement),
                json!({"lock":{"mode":0,"round_id":2}}).to_string()
            )
            .0,
        0
    );
    deliver(&mut fx, id, false, game::Game::on_unlock);
    assert_eq!(
        fx.game.get_lock(Mode::Solo, 1, actor.parse().unwrap()).0,
        old
    );
    assert_eq!(
        fx.game.get_lock(Mode::Solo, 2, actor.parse().unwrap()).0,
        replacement
    );
    deliver(&mut fx, id, true, game::Game::on_unlock);
    assert_eq!(
        fx.game.get_lock(Mode::Solo, 1, actor.parse().unwrap()).0,
        old
    );
}

#[test]
fn production_requires_funded_storage_at_each_lifetime_boundary() {
    let ctx = near_sdk::test_utils::VMContextBuilder::new();
    testing_env!(ctx.build());
    let mut p = game::params::production_defaults(params());
    p.genesis_ns = 2 * 3_600_000_000_000;
    game::Game::new(p.clone(), false);
    for field in 0..3 {
        let mut underfunded = p.clone();
        let charge = match field {
            0 => &mut underfunded.storage_charge_account,
            1 => &mut underfunded.storage_charge_per_play,
            _ => &mut underfunded.storage_charge_team,
        };
        charge.0 -= 1;
        testing_env!(ctx.build());
        assert!(
            panic_text(|| {
                game::Game::new(underfunded, false);
            })
            .contains("E11")
        );
    }
}
