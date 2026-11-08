mod common;
use common::*;
use game::PlayAck;
use near_sdk::{NearToken, PromiseResult, json_types::U128, testing_env};
use protocol::{Hex32, Mode};

fn count(fx: &Fx) -> u64 {
    fx.ledger()["pending_referee_requests"].as_u64().unwrap()
}

fn fill_plays(fx: &mut Fx) -> Vec<u64> {
    (0..8)
        .map(|i| {
            fx.actor(&format!("load{i}.near"));
            testing_env!(fx.ctx.build());
            fx.play(100 + i, "otter")
        })
        .collect()
}

#[test]
fn user_limit_preserves_state_and_settled_duplicates_remain_free() {
    let mut fx = fixture(params());
    let p = near_sdk::serde_json::to_value(fx.game.get_params()).unwrap();
    assert_eq!(p["max_pending_referee_requests"], 10);
    assert_eq!(p["user_referee_request_limit"], 8);
    let known = fx.play(1, "otter");
    fx.verdict(known, 0);
    fx.commit();
    fx.at(2, 0);
    let requests = fill_plays(&mut fx);
    assert_eq!(count(&fx), 8);
    fx.actor("bob.near");
    let ledger = fx.ledger();
    let round = fx.round();
    let commits = fx.commits();
    let state = borsh::to_vec(&fx.game).unwrap();
    let credit = fx.credit();
    assert!(matches!(
        fx.game.play(Mode::Solo, 1, "otter".into()),
        PlayAck::Known { .. }
    ));
    assert!(
        panic_text(|| {
            fx.game.play(Mode::Solo, 2, "otter".into());
        })
        .contains("E23")
    );
    let hex = fx.rule_hex();
    assert!(
        panic_text(|| {
            fx.game.reveal_guess(Mode::Solo, 0, hex, Hex32(SALT));
        })
        .contains("E23")
    );
    assert_eq!(fx.ledger(), ledger);
    assert_eq!(fx.round(), round);
    assert_eq!(fx.commits(), commits);
    assert_eq!(fx.credit(), credit);
    assert_eq!(borsh::to_vec(&fx.game).unwrap(), state);
    fx.verdict(requests[0], 0);
    assert_eq!(count(&fx), 7);
    let guess = fx.reveal(0);
    assert_eq!(count(&fx), 8);
    fx.verdict(requests[0], 0);
    assert_eq!(count(&fx), 8);
    fx.answer(guess, PromiseResult::Failed);
    assert_eq!(count(&fx), 7);
    fx.answer(guess, yes());
    assert_eq!(count(&fx), 7);
}

#[test]
fn reserved_lifecycle_slots_and_full_finalize_are_atomic() {
    let mut fx = fixture(params());
    for i in 0..21 {
        fx.actor(&format!("commit{i}.near"));
        fx.commit();
    }
    let requests = fill_plays(&mut fx);
    testing_env!(fx.ctx.build());
    let team_begin = fx.game.start_round(Mode::Team);
    assert_eq!(count(&fx), 9);
    fx.run_to_finalize(10);
    assert!(fx.game.finalize(Mode::Solo).is_none());
    testing_env!(fx.ctx.build());
    // The pending Team begin and Solo open consume both reserved slots.
    let open = fx.game.finalize(Mode::Solo).unwrap();
    assert_eq!(count(&fx), 10);
    fx.at(11, params().round_period_ns);
    let before = borsh::to_vec(&fx.game).unwrap();
    let ledger = fx.ledger();
    let round = fx.round();
    assert!(
        panic_text(|| {
            fx.game.start_round(Mode::Solo);
        })
        .contains("E23")
    );
    assert_eq!(borsh::to_vec(&fx.game).unwrap(), before);
    assert_eq!(fx.ledger(), ledger);
    assert_eq!(fx.round(), round);
    fx.on_open(open, PromiseResult::Failed);
    assert_eq!(count(&fx), 9);
    testing_env!(fx.ctx.build());
    // The open timeout has elapsed at the next slot, so consume a verdict instead.
    fx.verdict(requests[0], 0);
    assert_eq!(count(&fx), 8);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_begin(team_begin);
    assert_eq!(count(&fx), 7);
}

#[test]
fn full_capacity_rejects_finalize_before_any_commit_sweep() {
    let mut fx = fixture(params());
    testing_env!(fx.ctx.build());
    let team_begin = fx.game.start_round(Mode::Team);
    let begin = near_sdk::serde_json::json!({
        "commit": "11".repeat(32),
        "header": {"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}
    });
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(begin.to_string().into_bytes()),
    );
    fx.game.on_begin(team_begin);
    for i in 0..21 {
        fx.actor(&format!("sweep{i}.near"));
        fx.commit();
    }
    fill_plays(&mut fx);
    fx.at(10, INVESTIGATION_END);
    fx.game.advance(Mode::Solo);
    fx.game.advance(Mode::Team);
    fx.at(11, INVESTIGATION_END + params().reveal_window_ns);
    let team_open = fx.game.finalize(Mode::Team).unwrap();
    assert_eq!(count(&fx), 9);
    fx.at(12, params().round_period_ns);
    let next_team_begin = fx.game.start_round(Mode::Team);
    assert_eq!(count(&fx), 10);
    let before = borsh::to_vec(&fx.game).unwrap();
    let ledger = fx.ledger();
    let round = fx.round();
    let commits = fx.commits();
    assert!(
        panic_text(|| {
            fx.game.finalize(Mode::Solo);
        })
        .contains("E23")
    );
    assert_eq!(borsh::to_vec(&fx.game).unwrap(), before);
    assert_eq!(fx.ledger(), ledger);
    assert_eq!(fx.round(), round);
    assert_eq!(fx.commits(), commits);
    fx.on_open(team_open, PromiseResult::Failed);
    assert_eq!(count(&fx), 9);
    testing_env!(fx.ctx.build());
    assert!(fx.game.finalize(Mode::Solo).is_none());
    assert!(fx.commits()[..20].iter().all(|c| status(c) == "Unrevealed"));
    assert_eq!(status(&fx.commits()[20]), "Committed");
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_begin(next_team_begin);
    assert_eq!(count(&fx), 8);
}

#[test]
fn full_capacity_rejects_open_retry_without_mutation() {
    let mut p = params();
    p.open_timeout_ns = 3 * p.round_period_ns;
    let period = p.round_period_ns;
    let mut fx = fixture(p);
    testing_env!(fx.ctx.build());
    let begin = fx.game.start_round(Mode::Team);
    let response = near_sdk::serde_json::json!({
        "commit": "11".repeat(32),
        "header": {"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}
    });
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(response.to_string().into_bytes()),
    );
    fx.game.on_begin(begin);
    fx.at(10, INVESTIGATION_END);
    fx.game.advance(Mode::Solo);
    fx.game.advance(Mode::Team);
    fx.at(11, INVESTIGATION_END + params().reveal_window_ns);
    let solo_open = fx.game.finalize(Mode::Solo).unwrap();
    testing_env!(fx.ctx.build());
    let team_open = fx.game.finalize(Mode::Team).unwrap();
    fx.on_open(solo_open, PromiseResult::Failed);
    fx.on_open(team_open, PromiseResult::Failed);
    fx.at(12, period);
    let next_solo = fx.game.start_round(Mode::Solo);
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(response.to_string().into_bytes()),
    );
    fx.game.on_begin(next_solo);
    fill_plays(&mut fx);
    testing_env!(fx.ctx.build());
    let next_team = fx.game.start_round(Mode::Team);
    testing_env!(fx.ctx.build());
    let retry = fx.game.retry_open(Mode::Solo, 0);
    assert_eq!(count(&fx), 10);
    let before = borsh::to_vec(&fx.game).unwrap();
    let ledger = fx.ledger();
    let team =
        near_sdk::serde_json::to_value(fx.game.get_round(Mode::Team, Some(0)).unwrap()).unwrap();
    assert!(
        panic_text(|| {
            fx.game.retry_open(Mode::Team, 0);
        })
        .contains("E23")
    );
    assert_eq!(borsh::to_vec(&fx.game).unwrap(), before);
    assert_eq!(fx.ledger(), ledger);
    assert_eq!(
        near_sdk::serde_json::to_value(fx.game.get_round(Mode::Team, Some(0)).unwrap()).unwrap(),
        team
    );
    fx.on_open(retry, PromiseResult::Failed);
    assert_eq!(count(&fx), 9);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_begin(next_team);
    assert_eq!(count(&fx), 8);
}

#[test]
fn expiration_and_non_referee_requests_do_not_release_other_slots() {
    let mut fx = fixture(params());
    let request = fx.play(7, "otter");
    assert_eq!(count(&fx), 1);
    fx.actor("carol.near");
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    fx.game.withdraw_credit(U128(123));
    let withdraw = calls()
        .into_iter()
        .find(|(_, method, _, _)| method == "on_withdraw")
        .unwrap()
        .2["request_id"]
        .as_u64()
        .unwrap();
    testing_env!(fx.ctx.build());
    let register = fx.game.register_token();
    assert_eq!(count(&fx), 1);
    // Misrouted referee callbacks cannot consume other request kinds.
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_begin(withdraw);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_guess(request);
    assert_eq!(count(&fx), 1);
    fx.at(10, 600_000_000_000);
    assert!(!fx.game.expire_request(withdraw));
    assert!(fx.game.expire_request(register));
    assert_eq!(count(&fx), 1, "registration expiry released a referee slot");
    assert_eq!(
        fx.game.get_token_state("carol.near".parse().unwrap()),
        "none"
    );
    assert!(fx.game.expire_request(request));
    assert_eq!(count(&fx), 0);
    fx.actor("bob.near");
    testing_env!(fx.ctx.build());
    let replacement = fx.play(7, "otter");
    assert_eq!(count(&fx), 1);
    fx.verdict(request, 0);
    assert!(!fx.game.expire_request(request));
    assert_eq!(count(&fx), 1);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_withdraw(withdraw);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_register(register);
    assert_eq!(count(&fx), 1);
    fx.verdict(replacement, 0);
    assert_eq!(count(&fx), 0);
}
