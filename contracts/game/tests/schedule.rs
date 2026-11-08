mod common;
use common::*;
use near_sdk::serde_json::{json, to_value};
use near_sdk::{NearToken, PromiseResult, testing_env};
use protocol::Mode;

#[test]
fn logical_cutoff_and_late_advance_do_not_extend_reveal() {
    let p = params();
    let mut fx = fixture(p.clone());
    fx.at(2, INVESTIGATION_END - 1);
    let request = fx.play(1, "otter");
    let hash = fx.hash_for(&SALT);
    fx.at(3, INVESTIGATION_END);
    let before = fx.ledger();
    assert!(
        panic_text(|| {
            fx.game.play(Mode::Solo, 2, "otter".into());
        })
        .contains("E10")
    );
    assert!(
        panic_text(|| {
            fx.game.commit_guess(Mode::Solo, hash);
        })
        .contains("E10")
    );
    assert_eq!(fx.ledger(), before);
    fx.verdict(request, 0);
    assert_eq!(fx.round()["log_len"], 0);
    fx.at(4, INVESTIGATION_END + p.reveal_window_ns + 99);
    fx.game.advance(Mode::Solo, Some(0));
    let r = fx.round();
    assert_eq!(r["freeze_ns"], INVESTIGATION_END);
    assert_eq!(
        r["reveal_deadline_ns"],
        INVESTIGATION_END + p.reveal_window_ns
    );
    assert!(fx.game.finalize(Mode::Solo, Some(0)).is_some());
}

#[test]
fn reveal_without_advance_and_late_correct_cannot_extend_window() {
    let p = params();
    let mut fx = fixture(p.clone());
    fx.commit();
    fx.at(3, INVESTIGATION_END);
    let check = fx.reveal(0);
    fx.at(4, INVESTIGATION_END + p.reveal_window_ns + 1);
    fx.answer(
        check,
        PromiseResult::Successful(b"{\"correct\":true}".to_vec()),
    );
    let r = fx.round();
    assert_eq!(r["phase"], "Reveal");
    assert_eq!(r["freeze_ns"], INVESTIGATION_END);
    assert_eq!(
        r["reveal_deadline_ns"],
        INVESTIGATION_END + p.reveal_window_ns
    );
    assert_eq!(fx.commits()[0]["status"], "Correct");
    assert!(
        panic_text(|| {
            fx.game.play(Mode::Solo, 3, "otter".into());
        })
        .contains("E10")
    );
    assert!(fx.game.finalize(Mode::Solo, Some(0)).is_some());
}

#[test]
fn reveal_deadline_is_exclusive_even_without_advance() {
    let p = params();
    let mut fx = fixture(p.clone());
    fx.commit();
    fx.at(3, INVESTIGATION_END + p.reveal_window_ns);
    let before = fx.ledger();
    assert!(
        panic_text(|| {
            fx.reveal(0);
        })
        .contains("E16")
    );
    assert_eq!(fx.ledger(), before);
    assert_eq!(fx.commits()[0]["status"], "Committed");
}

#[test]
fn scoped_calls_reject_wrong_target_atomically_and_retry_same_id() {
    let mut fx = fixture(params());
    let state = borsh::to_vec(&fx.game).unwrap();
    assert!(
        panic_text(|| {
            fx.game.start_round(Mode::Solo, Some(99));
        })
        .contains("E50")
    );
    assert!(
        panic_text(|| {
            fx.game.advance(Mode::Solo, Some(99));
        })
        .contains("E50")
    );
    assert!(
        panic_text(|| {
            fx.game.finalize(Mode::Solo, Some(99));
        })
        .contains("E50")
    );
    assert_eq!(borsh::to_vec(&fx.game).unwrap(), state);
    fx.run_to_finalize(10);
    let open = fx.game.finalize(Mode::Solo, Some(0)).unwrap();
    fx.on_open(open, PromiseResult::Failed);
    fx.at(20, 100 * params().round_period_ns);
    let before = fx.ledger();
    let required: u128 = before["operator_storage_required"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let available: u128 = before["operator_storage_available"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let balance = fx.ctx.build().account_balance.as_yoctonear();
    let extra = 1024 * near_sdk::env::storage_byte_cost().as_yoctonear();
    fx.ctx.account_balance(NearToken::from_yoctonear(
        balance - available + required + extra - 1,
    ));
    testing_env!(fx.ctx.build());
    assert!(
        panic_text(|| {
            fx.game.start_round(Mode::Solo, Some(100));
        })
        .contains("E24")
    );
    assert!(fx.game.get_round(Mode::Solo, Some(100)).is_none());
    fx.ctx.account_balance(NearToken::from_yoctonear(
        balance - available + required + extra,
    ));
    testing_env!(fx.ctx.build());
    let begin = fx.game.start_round(Mode::Solo, Some(100));
    let after = fx.ledger();
    assert_eq!(
        after["operator_storage_required"]
            .as_str()
            .unwrap()
            .parse::<u128>()
            .unwrap(),
        required + extra
    );
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_begin(begin);
    testing_env!(fx.ctx.build());
    let snapshot = borsh::to_vec(&fx.game).unwrap();
    assert!(
        panic_text(|| {
            fx.game.start_round(Mode::Solo, Some(101));
        })
        .contains("E50")
    );
    assert_eq!(borsh::to_vec(&fx.game).unwrap(), snapshot);
    fx.game.start_round(Mode::Solo, Some(100));
    assert_eq!(
        fx.ledger()["operator_storage_required"],
        after["operator_storage_required"]
    );
}

#[test]
fn production_begin_is_slot_anchored_and_expired_begin_cancels() {
    const HOUR: u64 = 3_600_000_000_000;
    for expired in [false, true] {
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut ctx = near_sdk::test_utils::VMContextBuilder::new();
        ctx.prepaid_gas(near_sdk::Gas::from_tgas(300));
        testing_env!(ctx.build());
        let mut p = game::params::production_defaults(params());
        p.genesis_ns = 2 * HOUR;
        let mut game = game::Game::new(p.clone(), false);
        ctx.block_timestamp(p.genesis_ns);
        testing_env!(ctx.build());
        let request = game.start_round(Mode::Solo, Some(0));
        ctx.block_timestamp(
            p.genesis_ns
                + if expired {
                    p.begin_timeout_ns
                } else {
                    p.begin_timeout_ns - 1
                },
        );
        let begin = json!({"commit":"11".repeat(32),"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
        deliver_env(
            &ctx,
            PromiseResult::Successful(begin.to_string().into_bytes()),
        );
        game.on_begin(request);
        let round = to_value(game.get_round(Mode::Solo, Some(0)).unwrap()).unwrap();
        if expired {
            assert_eq!(round["phase"], "Cancelled");
        } else {
            assert_eq!(
                round["investigation_end_ns"],
                p.genesis_ns + p.investigation_max_ns
            );
        }
    }
}

#[test]
fn impossible_production_schedules_are_rejected() {
    const HOUR: u64 = 3_600_000_000_000;
    for variant in 0..5 {
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut ctx = near_sdk::test_utils::VMContextBuilder::new();
        ctx.prepaid_gas(near_sdk::Gas::from_tgas(300));
        testing_env!(ctx.build());
        let mut p = game::params::production_defaults(params());
        p.genesis_ns = 2 * HOUR;
        match variant {
            0 => p.investigation_max_ns = 0,
            1 => p.investigation_max_ns = p.round_period_ns,
            2 => {
                p.round_period_ns = 48 * HOUR;
                p.investigation_max_ns = 24 * HOUR;
            }
            3 => p.mode_offset_ns[0] = p.round_period_ns,
            _ => p.genesis_ns = u64::MAX,
        }
        assert!(
            panic_text(|| {
                game::Game::new(p, false);
            })
            .contains("E11")
        );
    }
}
