mod common;
use common::*;
use game::PlayAck;
use near_sdk::serde_json::{Value, json};
use near_sdk::{NearToken, PromiseResult, testing_env};
use protocol::Mode;

fn register(f: &mut Fx, name: &str) {
    f.actor(name);
    f.ctx.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(f.ctx.build());
}

fn begin_team(f: &mut Fx) {
    let begin = f.game.start_round(Mode::Team, None);
    let commit = protocol::round_commitment(&f.rule, &ROUND_SALT);
    let response = json!({"commit":commit,"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
    deliver_env(
        &f.ctx,
        PromiseResult::Successful(response.to_string().into_bytes()),
    );
    f.game.on_begin(begin);
    testing_env!(f.ctx.build());
}

fn team(f: &mut Fx) -> u32 {
    register(f, "alice.near");
    f.game.create_team("alpha".into())
}

fn join(f: &mut Fx, id: u32, name: &str) {
    register(f, "alice.near");
    f.game.invite(name.parse().unwrap());
    register(f, name);
    f.game.join_team(id);
}

fn deposit(f: &mut Fx, id: u32, amount: u128) {
    f.ctx.attached_deposit(NearToken::from_yoctonear(amount));
    testing_env!(f.ctx.build());
    f.game.team_deposit(id);
    f.ctx.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(f.ctx.build());
}

fn state(f: &Fx, id: u32) -> Value {
    f.game.get_team(id).unwrap()
}

#[test]
fn roster_is_bounded_and_captain_can_revoke_invitation() {
    let mut f = fixture(params());
    let id = team(&mut f);
    for name in ["one.near", "two.near", "three.near", "four.near"] {
        join(&mut f, id, name);
    }
    register(&mut f, "alice.near");
    assert!(panic_text(|| f.game.invite("five.near".parse().unwrap())).contains("E31"));
    f.game.remove_member("four.near".parse().unwrap());
    f.game.invite("five.near".parse().unwrap());
    f.game.remove_member("five.near".parse().unwrap());
    assert_eq!(state(&f, id)["members"].as_array().unwrap().len(), 4);
}

#[test]
fn only_captain_manages_invites_and_uninvited_cannot_join() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "other.near");
    let before = state(&f, id);
    assert!(panic_text(|| f.game.invite("third.near".parse().unwrap())).contains("E33"));
    assert!(panic_text(|| f.game.remove_member("alice.near".parse().unwrap())).contains("E33"));
    register(&mut f, "third.near");
    assert!(panic_text(|| f.game.join_team(id)).contains("E33"));
    assert_eq!(state(&f, id), before);
}

#[test]
fn team_members_share_pending_play_and_attempt_limit() {
    let mut p = params();
    p.base_attempts[1] = 2;
    let mut f = fixture(p);
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 40_000);
    begin_team(&mut f);
    let alice_credit = credit_of(&f.game, "alice.near");
    let other_credit = credit_of(&f.game, "other.near");
    let first = match f.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    register(&mut f, "other.near");
    let pending = state(&f, id);
    assert!(
        panic_text(|| {
            f.game.play(Mode::Team, 418, "otter".into());
        })
        .contains("E13")
    );
    assert_eq!(state(&f, id), pending);
    f.verdict(first, 0);
    let second = match f.game.play(Mode::Team, 418, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    f.verdict(second, 0);
    register(&mut f, "alice.near");
    let exhausted = state(&f, id);
    assert_eq!(exhausted["vault"], "19800");
    assert!(
        panic_text(|| {
            f.game.play(Mode::Team, 419, "otter".into());
        })
        .contains("E14")
    );
    assert_eq!(state(&f, id), exhausted);
    assert_eq!(credit_of(&f.game, "alice.near"), alice_credit);
    assert_eq!(credit_of(&f.game, "other.near"), other_credit);
}

#[test]
fn first_commit_locks_roster_and_charges_vault() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 40_000);
    begin_team(&mut f);
    let credit = credit_of(&f.game, "alice.near");
    f.game.commit_guess(Mode::Team, protocol::Hex32([0; 32]));
    assert_eq!(state(&f, id)["vault"], "39800");
    assert_eq!(credit_of(&f.game, "alice.near"), credit);
    assert!(panic_text(|| f.game.remove_member("other.near".parse().unwrap())).contains("E30"));
    register(&mut f, "other.near");
    assert!(panic_text(|| f.game.leave_team()).contains("E30"));
}

#[test]
fn vault_spend_refund_and_roster_lock() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 30_000);
    register(&mut f, "other.near");
    deposit(&mut f, id, 10_000);
    begin_team(&mut f);
    let req = match f.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    assert_eq!(state(&f, id)["vault"], "29900");
    assert!(panic_text(|| f.game.leave_team()).contains("E30"));
    deliver_env(&f.ctx, PromiseResult::Failed);
    f.game.on_verdict(req);
    assert_eq!(state(&f, id)["vault"], "40000");
    assert!(state(&f, id)["active_round"].is_null());
    f.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(f.ctx.build());
    assert_eq!(f.game.team_withdraw(id).0, 10_000);
    assert_eq!(state(&f, id)["vault"], "30000");
}

#[test]
fn departing_depositor_receives_weighted_credit_and_captain_changes() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 300);
    register(&mut f, "other.near");
    deposit(&mut f, id, 100);
    register(&mut f, "alice.near");
    let before: Value = f.game.get_player("alice.near".parse().unwrap()).unwrap();
    f.game.leave_team();
    let after: Value = f.game.get_player("alice.near".parse().unwrap()).unwrap();
    let parse = |v: &Value| v["credit"].as_str().unwrap().parse::<u128>().unwrap();
    assert_eq!(parse(&after) - parse(&before), 300);
    assert_eq!(state(&f, id)["captain"], "other.near");
    assert_eq!(state(&f, id)["vault"], "100");
}

fn finish_team(f: &mut Fx, valid_open: bool) {
    f.at(10, INVESTIGATION_END);
    f.game.advance(Mode::Team, None);
    let round =
        near_sdk::serde_json::to_value(f.game.get_round(Mode::Team, Some(0)).unwrap()).unwrap();
    f.at(11, round["reveal_deadline_ns"].as_u64().unwrap());
    let request = f.game.finalize(Mode::Team, None).expect("open request");
    let response = if valid_open {
        f.open_ok()
    } else {
        f.open_with([9; 32])
    };
    f.on_open(request, response);
}

#[test]
fn equal_team_rewards_remain_claimable_after_leaving() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 40_000);
    begin_team(&mut f);
    let request = match f.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    f.verdict(request, 0);
    finish_team(&mut f, true);
    assert_eq!(f.game.settle_team(id).0, 0);
    register(&mut f, "alice.near");
    f.game.leave_team();
    assert_eq!(f.game.claim_team(Mode::Team, 0, id).0, 1600);
    assert!(
        panic_text(|| {
            f.game.claim_team(Mode::Team, 0, id);
        })
        .contains("E56")
    );
    register(&mut f, "other.near");
    assert_eq!(f.game.claim_team(Mode::Team, 0, id).0, 1600);
}

#[test]
fn void_refunds_team_pot_contribution_to_original_vault() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 40_000);
    begin_team(&mut f);
    let request = match f.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    f.verdict(request, 0);
    finish_team(&mut f, false);
    assert!(panic_text(|| f.game.leave_team()).contains("E30"));
    assert_eq!(f.game.settle_team(id).0, 8000);
    assert_eq!(state(&f, id)["vault"], "37900");
    f.game.leave_team();
    assert_eq!(state(&f, id)["vault"], "0");
}

#[test]
fn team_guess_is_actor_bound_and_returns_stake_to_vault() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 40_000);
    f.ctx.attached_deposit(NearToken::from_yoctonear(1003));
    testing_env!(f.ctx.build());
    f.game.seed_pot(Mode::Team);
    f.ctx.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(f.ctx.build());
    begin_team(&mut f);
    f.at(1, 0);
    let ctx = f.ctx.build();
    let hash = protocol::commit_hash(&protocol::CommitPreimage {
        chain: "testnet",
        game: ctx.current_account_id.as_str(),
        mode: Mode::Team,
        round: 0,
        actor: ctx.predecessor_account_id.as_str(),
        entity: protocol::Entity::Team(id),
        guess: &f.rule,
        salt: &SALT,
    });
    f.game.commit_guess(Mode::Team, hash);
    assert_eq!(state(&f, id)["vault"], "39800");
    f.at(3, 0);
    register(&mut f, "other.near");
    let guess = f.rule_hex();
    assert!(
        panic_text(|| {
            f.game
                .reveal_guess(Mode::Team, 0, guess.clone(), protocol::Hex32(SALT));
        })
        .contains("E17")
    );
    register(&mut f, "alice.near");
    let req = f
        .game
        .reveal_guess(Mode::Team, 0, guess, protocol::Hex32(SALT));
    f.answer(req, yes());
    let round =
        near_sdk::serde_json::to_value(f.game.get_round(Mode::Team, Some(0)).unwrap()).unwrap();
    f.at(4, round["reveal_deadline_ns"].as_u64().unwrap());
    let request = f.game.finalize(Mode::Team, None).unwrap();
    let response = f.open_ok();
    f.on_open(request, response);
    assert_eq!(f.game.settle_team(id).0, 100);
    let settled = state(&f, id);
    let stakes = f.term("open_stakes");
    assert!(
        panic_text(|| {
            f.game.settle_team(id);
        })
        .contains("E56")
    );
    assert_eq!(state(&f, id), settled);
    assert_eq!(f.term("open_stakes"), stakes);
    assert_eq!(f.game.claim_team(Mode::Team, 0, id).0, 200);
    register(&mut f, "other.near");
    assert_eq!(f.game.claim_team(Mode::Team, 0, id).0, 200);
    assert_eq!(f.term("carry"), 503);
    assert_eq!(state(&f, id)["vault"], "39900");
}

#[test]
fn team_lock_tier_sums_members_and_preserves_each_lock() {
    let mut p = params();
    p.lock_tiers = vec![protocol::params::LockTier {
        amount: protocol::params::Amount(100),
        extra_attempts: 25,
    }];
    let mut f = fixture(p);
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    for (actor, amount) in [("alice.near", 40), ("other.near", 60)] {
        f.ctx
            .predecessor_account_id("token.testnet".parse().unwrap());
        testing_env!(f.ctx.build());
        assert_eq!(
            f.game
                .ft_on_transfer(
                    actor.parse().unwrap(),
                    near_sdk::json_types::U128(amount),
                    json!({"lock":{"mode":1,"round_id":0}}).to_string()
                )
                .0,
            0
        );
    }
    for (actor, amount) in [("alice.near", 40), ("other.near", 60)] {
        assert_eq!(
            f.game.get_lock(Mode::Team, 0, actor.parse().unwrap()).0,
            amount
        );
        let view = near_sdk::serde_json::to_value(f.game.get_entity(
            Mode::Team,
            0,
            actor.parse().unwrap(),
        ))
        .unwrap();
        assert_eq!(view["limit"], 75);
    }
}

#[test]
fn commits_and_line_are_shared_across_team_members() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 40_000);
    begin_team(&mut f);
    let request = match f.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    f.verdict(request, 1);
    register(&mut f, "other.near");
    let entity = near_sdk::serde_json::to_value(f.game.get_entity(
        Mode::Team,
        0,
        "other.near".parse().unwrap(),
    ))
    .unwrap();
    assert_eq!(entity["attempts"], 1);
    assert_eq!(entity["line"]["number"], 417);
    for _ in 0..3 {
        f.game.commit_guess(Mode::Team, protocol::Hex32([0; 32]));
    }
    register(&mut f, "alice.near");
    assert!(
        panic_text(|| {
            f.game.commit_guess(Mode::Team, protocol::Hex32([1; 32]));
        })
        .contains("E15")
    );
    assert!(panic_text(|| f.game.remove_member("other.near".parse().unwrap())).contains("E30"));
}

#[test]
fn cancelled_team_round_refunds_vault_before_withdrawal() {
    let mut f = fixture(params());
    let id = team(&mut f);
    deposit(&mut f, id, 40_000);
    begin_team(&mut f);
    let request = match f.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    f.verdict(request, 0);
    f.at(10, INVESTIGATION_END);
    f.game.advance(Mode::Team, None);
    let round =
        near_sdk::serde_json::to_value(f.game.get_round(Mode::Team, Some(0)).unwrap()).unwrap();
    let deadline = round["reveal_deadline_ns"].as_u64().unwrap();
    f.at(11, deadline);
    let open = f.game.finalize(Mode::Team, None).unwrap();
    f.on_open(open, PromiseResult::Failed);
    f.at(12, deadline + params().open_timeout_ns);
    f.game.cancel(Mode::Team, 0);
    assert!(panic_text(|| f.game.leave_team()).contains("E30"));
    assert_eq!(f.game.settle_team(id).0, 8000);
    assert_eq!(state(&f, id)["vault"], "37900");
}

#[test]
fn new_capital_cannot_subsidize_previous_round_losses() {
    let mut f = fixture(params());
    let id = team(&mut f);
    join(&mut f, id, "other.near");
    register(&mut f, "alice.near");
    deposit(&mut f, id, 40_000);
    begin_team(&mut f);
    let request = match f.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    f.verdict(request, 0);
    finish_team(&mut f, true);
    f.game.settle_team(id);
    let before = state(&f, id);
    assert_eq!(before["vault"], "29900");
    register(&mut f, "other.near");
    f.ctx.attached_deposit(NearToken::from_yoctonear(10_000));
    testing_env!(f.ctx.build());
    assert!(panic_text(|| f.game.team_deposit(id)).contains("E30"));
    assert_eq!(state(&f, id), before);
    // Closing old principal positions restores a clean deposit epoch.
    register(&mut f, "alice.near");
    f.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(f.ctx.build());
    assert_eq!(f.game.team_withdraw(id).0, 29_900);
    register(&mut f, "other.near");
    deposit(&mut f, id, 10_000);
    f.ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(f.ctx.build());
    assert_eq!(f.game.team_withdraw(id).0, 10_000);
    assert_eq!(state(&f, id)["vault"], "0");
}
