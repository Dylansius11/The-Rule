//! Bounded root state must not grow with unattended Opening rounds.
mod common;
use common::*;
use near_sdk::{
    PromiseResult,
    serde_json::{json, to_value},
    testing_env,
};
use protocol::Mode;

#[test]
fn active_round_capacity_rejects_atomically_and_cancel_releases_room() {
    const PERIOD: u64 = 86_400_000_000_000;
    let mut p = params();
    p.open_timeout_ns = 100 * PERIOD;
    p.referee.urls = vec!["x".repeat(2048); 2];
    p.referee.outlayer = "o".repeat(64);
    p.token = "t".repeat(64);
    p.platform = "p".repeat(64);
    p.lock_tiers = vec![
        protocol::params::LockTier {
            amount: protocol::params::Amount(u128::MAX),
            extra_attempts: u16::MAX,
        };
        3
    ];
    let mut fx = fixture(p);
    for id in 0..10u32 {
        if id > 0 {
            fx.at(100 + u64::from(id) * 10, u64::from(id) * PERIOD);
            let request = fx.game.start_round(Mode::Solo);
            let begin = json!({"commit":protocol::round_commitment(&fx.rule, &ROUND_SALT),"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
            deliver_env(
                &fx.ctx,
                PromiseResult::Successful(begin.to_string().into_bytes()),
            );
            fx.game.on_begin(request);
        }
        let r = to_value(fx.game.get_round(Mode::Solo, Some(id)).unwrap()).unwrap();
        fx.at(
            101 + u64::from(id) * 10,
            r["investigation_end_ns"].as_u64().unwrap(),
        );
        fx.game.advance(Mode::Solo);
        let r = to_value(fx.game.get_round(Mode::Solo, Some(id)).unwrap()).unwrap();
        fx.at(
            102 + u64::from(id) * 10,
            r["reveal_deadline_ns"].as_u64().unwrap(),
        );
        testing_env!(fx.ctx.build());
        let request = fx.game.finalize(Mode::Solo).unwrap();
        fx.on_open(request, PromiseResult::Failed);
    }
    assert_eq!(fx.game.get_active_rounds().len(), 10);
    let root_bytes = borsh::to_vec(&fx.game).unwrap().len();
    println!(
        "MAX ROOT: serialized={root_bytes} bytes with maximum config and ten active rounds; reserve ceiling=8192 bytes including remaining fixed-width option growth"
    );
    assert!(
        root_bytes + 4 <= 8192,
        "root-state funding ceiling exceeded"
    );
    fx.at(300, 10 * PERIOD);
    let before_ledger = fx.ledger();
    let before_slot = fx.game.get_next_slot(Mode::Solo);
    assert!(
        panic_text(|| {
            fx.game.start_round(Mode::Solo);
        })
        .contains("E23")
    );
    assert_eq!(fx.ledger(), before_ledger);
    assert_eq!(fx.game.get_next_slot(Mode::Solo), before_slot);
    assert_eq!(fx.game.get_active_rounds().len(), 10);
    fx.at(400, 102 * PERIOD);
    fx.game.cancel(Mode::Solo, 0);
    testing_env!(fx.ctx.build());
    let request = fx.game.start_round(Mode::Solo);
    assert_eq!(fx.game.get_active_rounds().len(), 10);
    assert_eq!(
        to_value(fx.game.get_round(Mode::Solo, Some(10)).unwrap()).unwrap()["phase"],
        "Sealing"
    );
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_begin(request);
}

#[test]
fn production_operator_budget_never_borrows_player_or_pot_money() {
    use near_sdk::NearToken;
    let near = 1_000_000_000_000_000_000_000_000u128;
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut ctx = near_sdk::test_utils::VMContextBuilder::new();
    ctx.prepaid_gas(near_sdk::Gas::from_tgas(300))
        .storage_usage(1000);
    testing_env!(ctx.build());
    let mut p = game::params::production_defaults(params());
    p.genesis_ns = 2 * 3_600_000_000_000;
    let mut game = game::Game::new(p.clone(), false);
    ctx.attached_deposit(NearToken::from_near(10));
    testing_env!(ctx.build());
    game.deposit_credit();
    ctx.attached_deposit(NearToken::from_near(1));
    testing_env!(ctx.build());
    game.fund_compute();
    testing_env!(ctx.build());
    game.seed_pot(Mode::Solo);
    let principal = 12 * near;
    ctx.attached_deposit(NearToken::from_yoctonear(0))
        .account_balance(NearToken::from_yoctonear(principal))
        .block_timestamp(p.genesis_ns);
    testing_env!(ctx.build());
    let ledger = to_value(game.get_ledger()).unwrap();
    assert_eq!(ledger["operator_storage_available"], "0");
    let required = num(&ledger["operator_storage_required"])
        + 1024 * near_sdk::env::storage_byte_cost().as_yoctonear();
    ctx.account_balance(NearToken::from_yoctonear(principal + required - 1));
    testing_env!(ctx.build());
    let before = to_value(game.get_ledger()).unwrap();
    assert!(
        panic_text(|| {
            game.start_round(Mode::Solo);
        })
        .contains("E24")
    );
    assert!(game.get_round(Mode::Solo, None).is_none());
    assert_eq!(to_value(game.get_ledger()).unwrap(), before);
    // An unallocated direct top-up, not another player's credit or a seed, pays the budget.
    ctx.account_balance(NearToken::from_yoctonear(principal + required));
    testing_env!(ctx.build());
    let first = game.start_round(Mode::Solo);
    let ledger = to_value(game.get_ledger()).unwrap();
    assert_eq!(num(&ledger["operator_storage_required"]), required);
    deliver_env(&ctx, PromiseResult::Failed);
    game.on_begin(first);
    testing_env!(ctx.build());
    game.start_round(Mode::Solo); // retry uses the already reserved round, not another 1024 B
    let ledger = to_value(game.get_ledger()).unwrap();
    assert_eq!(num(&ledger["operator_storage_required"]), required);
    assert_eq!(
        num(&ledger["credit"]) + num(&ledger["storage_reserve"]),
        10 * near
    );
    assert_eq!(num(&ledger["carry"]), 0);
    assert_eq!(num(&ledger["round_pots"]), near);
}

#[test]
fn refunded_native_principal_is_not_operator_collateral_before_callback() {
    use near_sdk::{NearToken, json_types::U128};
    for platform in [false, true] {
        let mut fx = fixture(params());
        let play = fx.play(1, "otter");
        fx.verdict(play, 0);
        let before = fx.ledger();
        let liabilities: u128 = [
            "credit",
            "vault",
            "round_pots",
            "carry",
            "open_stakes",
            "claimable",
            "compute_float",
            "platform_accrued",
            "pending_credit",
            "storage_reserve",
        ]
        .iter()
        .map(|key| num(&before[key]))
        .sum();
        let required = num(&before["operator_storage_required"])
            + 1024 * near_sdk::env::storage_byte_cost().as_yoctonear();
        let balance = liabilities + required - 1;
        fx.ctx
            .account_balance(NearToken::from_yoctonear(balance))
            .attached_deposit(NearToken::from_yoctonear(u128::from(!platform)));
        testing_env!(fx.ctx.build());
        let request = if platform {
            fx.game.claim_platform()
        } else {
            fx.game.withdraw_credit(U128(500));
            calls()
                .into_iter()
                .find(|(_, method, _, _)| method == "on_withdraw")
                .unwrap()
                .2["request_id"]
                .as_u64()
                .unwrap()
        };
        // Model the failure's principal refund arriving before its callback.
        // This tests an admissible accounting order, not observed sandbox scheduling.
        fx.ctx
            .account_balance(NearToken::from_yoctonear(balance))
            .attached_deposit(NearToken::from_yoctonear(0));
        testing_env!(fx.ctx.build());
        let pending = fx.ledger();
        assert_eq!(num(&pending["pending_native_payments"]), 500);
        assert!(
            panic_text(|| {
                fx.game.start_round(Mode::Team);
            })
            .contains("E24"),
            "pending native refund was borrowed as operator collateral, platform={platform}"
        );
        assert_eq!(fx.ledger(), pending);
        assert!(fx.game.get_round(Mode::Team, None).is_none());
        deliver_env(&fx.ctx, PromiseResult::Failed);
        if platform {
            fx.game.on_platform(request);
        } else {
            fx.game.on_withdraw(request);
        }
        assert_eq!(
            num(&fx.ledger()["operator_storage_available"]),
            required - 1
        );
        assert_eq!(num(&fx.ledger()["pending_native_payments"]), 0);
        // Matching callback consumes the reservation once; a duplicate cannot free it twice.
        deliver_env(&fx.ctx, PromiseResult::Successful(Vec::new()));
        if platform {
            fx.game.on_platform(request);
        } else {
            fx.game.on_withdraw(request);
        }
        assert_eq!(
            num(&fx.ledger()["operator_storage_available"]),
            required - 1
        );
    }
}
