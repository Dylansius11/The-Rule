mod common;

use common::*;
use game::PlayAck;
use near_sdk::serde_json::{self, Value};
use protocol::Mode;

fn board(fx: &mut Fx, mode: Mode, season: u32) -> Vec<Value> {
    fx.game.index_season(mode, season, 20);
    fx.game
        .get_season(mode, season, None, 200)
        .into_iter()
        .map(|row| serde_json::to_value(row).unwrap())
        .collect()
}

#[test]
fn settled_shares_and_rewards_do_not_depend_on_claims_or_duplicates() {
    let mut fx = fixture(params());
    let request = fx.play(2, "otter");
    fx.verdict(request, 0);
    assert!(matches!(
        fx.game.play(Mode::Solo, 2, "otter".into()),
        PlayAck::Known { .. }
    ));
    fx.actor("carol.near");
    let request = fx.play(3, "otter");
    fx.verdict(request, 0);
    fx.run_to_finalize(10);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    let before = board(&mut fx, Mode::Solo, 0);
    assert_eq!(before.len(), 2);
    assert_eq!(before[0]["entity_id"], 0);
    assert_eq!(before[1]["entity_id"], 1);
    for row in &before {
        assert_eq!(row["entity_tag"], 0);
        assert_eq!(row["rounds_won"], 0);
        assert_eq!(row["shares"], 1);
        assert_eq!(row["earned"], "3200");
        assert!(row["earliest_winning_block"].is_null());
    }
    fx.game.claim(Mode::Solo, 0);
    assert_eq!(board(&mut fx, Mode::Solo, 0), before);
    assert!(board(&mut fx, Mode::Team, 0).is_empty());
    assert!(board(&mut fx, Mode::Solo, 1).is_empty());
}

#[test]
fn void_round_does_not_count_refunds_as_earnings() {
    let mut fx = fixture(params());
    let request = fx.play(2, "otter");
    fx.verdict(request, 0);
    fx.run_to_finalize(10);
    let (_, open) = fx.finalize_all();
    let result = fx.open_with([9; 32]);
    fx.on_open(open, result);
    for row in board(&mut fx, Mode::Solo, 0) {
        assert_eq!(row["rounds_won"], 0);
        assert_eq!(row["shares"], 0);
        assert_eq!(row["earned"], "0");
    }
}

#[test]
fn winner_is_earliest_commit_not_first_correct_callback_and_stakes_are_excluded() {
    let mut fx = fixture(params());
    let play = fx.play(2, "otter");
    fx.verdict(play, 0);
    fx.actor("carol.near");
    let play = fx.play(3, "otter");
    fx.verdict(play, 0);
    fx.at(10, 0);
    fx.commit();
    fx.actor("bob.near");
    fx.commit();
    fx.at(12, 1_000);
    let bob = fx.reveal(1);
    fx.actor("carol.near");
    let carol = fx.reveal(0);
    fx.at(13, 1_000);
    fx.answer(bob, yes());
    fx.at(14, 1_000);
    fx.answer(carol, yes());
    let deadline = fx.round()["reveal_deadline_ns"].as_u64().unwrap();
    fx.at(20, deadline);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    let rows = board(&mut fx, Mode::Solo, 0);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["entity_id"], 1);
    assert_eq!(rows[0]["rounds_won"], 1);
    assert_eq!(rows[0]["shares"], 1);
    assert_eq!(rows[0]["earned"], "9600");
    assert_eq!(rows[0]["earliest_winning_block"], 10);
    assert_eq!(rows[1]["entity_id"], 0);
    assert_eq!(rows[1]["earned"], "3200");
}

#[test]
fn missed_slots_do_not_allow_multiple_rounds_in_the_same_period() {
    const DAY: u64 = 86_400_000_000_000;
    let mut fx = fixture(params());
    fx.run_to_finalize(10);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    fx.at(20, 3 * DAY);
    let request = fx.game.start_round(Mode::Solo, None);
    deliver_env(
        &fx.ctx,
        near_sdk::PromiseResult::Successful(b"null".to_vec()),
    );
    fx.game.on_begin(request);
    let retry = fx.game.start_round(Mode::Solo, None);
    deliver_env(
        &fx.ctx,
        near_sdk::PromiseResult::Successful(b"null".to_vec()),
    );
    fx.game.on_begin(retry);
    fx.at(21, 3 * DAY + 3_600_000_000_000);
    fx.game.cancel(Mode::Solo, 3);
    assert!(
        panic_text(|| {
            fx.game.start_round(Mode::Solo, None);
        })
        .contains("E50")
    );
    fx.at(22, 4 * DAY - 1);
    assert!(
        panic_text(|| {
            fx.game.start_round(Mode::Solo, None);
        })
        .contains("E50")
    );
    fx.at(23, 4 * DAY);
    fx.game.start_round(Mode::Solo, None);
}

#[test]
fn rebuilding_after_revision_removes_stale_rank_entries() {
    let mut fx = fixture(params());
    let a = fx.play(1, "otter");
    fx.verdict(a, 0);
    fx.actor("carol.near");
    let b = fx.play(2, "otter");
    fx.verdict(b, 0);
    fx.game.index_season(Mode::Solo, 0, 1);
    assert!(
        panic_text(|| {
            fx.game.get_season(Mode::Solo, 0, None, 200);
        })
        .contains("E50")
    );
    fx.run_to_finalize(10);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    assert!(
        panic_text(|| {
            fx.game.get_season(Mode::Solo, 0, None, 200);
        })
        .contains("E50")
    );
    fx.game.index_season(Mode::Solo, 0, 1);
    assert!(
        panic_text(|| {
            fx.game.get_season(Mode::Solo, 0, None, 200);
        })
        .contains("E50")
    );
    fx.game.index_season(Mode::Solo, 0, 1);
    let rows = fx.game.get_season(Mode::Solo, 0, None, 200);
    assert_eq!(rows.len(), 2);
    let first = serde_json::to_value(&rows[0]).unwrap();
    let cursor = serde_json::from_value(first["cursor"].clone()).unwrap();
    let second = fx.game.get_season(Mode::Solo, 0, Some(cursor), 200);
    assert_eq!(second.len(), 1);
    assert_eq!(serde_json::to_value(&second[0]).unwrap()["entity_id"], 1);
}

#[test]
fn production_begin_respects_full_reveal_window_and_fences_duplicate_callbacks() {
    use near_sdk::{Gas, PromiseResult, test_utils::VMContextBuilder, testing_env};
    const HOUR: u64 = 3_600_000_000_000;
    const INVESTIGATION: u64 = 23 * HOUR;
    for delta in [-1i64, 0, 1] {
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut ctx = VMContextBuilder::new();
        ctx.prepaid_gas(Gas::from_tgas(300)).block_timestamp(0);
        testing_env!(ctx.build());
        let mut p = game::params::production_defaults(params());
        p.genesis_ns = 2 * HOUR;
        let cutoff = p.genesis_ns + INVESTIGATION;
        let mut game = game::Game::new(p, false);
        ctx.block_timestamp(cutoff - 2);
        testing_env!(ctx.build());
        let request = game.start_round(Mode::Solo, None);
        let timestamp = cutoff.checked_add_signed(delta).unwrap();
        ctx.block_timestamp(timestamp);
        let begin = near_sdk::serde_json::json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
        deliver_env(
            &ctx,
            PromiseResult::Successful(begin.to_string().into_bytes()),
        );
        game.on_begin(request);
        let first = serde_json::to_value(game.get_round(Mode::Solo, Some(0)).unwrap()).unwrap();
        assert_eq!(
            first["phase"],
            if delta < 0 {
                "Investigation"
            } else if delta == 0 {
                "Reveal"
            } else {
                "Cancelled"
            }
        );
        if delta == 0 {
            assert_eq!(first["freeze_ns"], cutoff);
            assert_eq!(first["reveal_deadline_ns"], cutoff + 30 * 60_000_000_000);
        }
        if delta < 0 {
            assert_eq!(first["investigation_end_ns"], cutoff);
            assert!(first["freeze_ns"].is_null());
        }
        let ledger = serde_json::to_value(game.get_ledger()).unwrap();
        deliver_env(
            &ctx,
            PromiseResult::Successful(begin.to_string().into_bytes()),
        );
        game.on_begin(request);
        assert_eq!(
            serde_json::to_value(game.get_round(Mode::Solo, Some(0)).unwrap()).unwrap(),
            first
        );
        assert_eq!(serde_json::to_value(game.get_ledger()).unwrap(), ledger);
    }
}

#[test]
fn numbered_slots_six_and_seven_land_in_different_seasons() {
    const DAY: u64 = 86_400_000_000_000;
    let mut fx = fixture(params());
    fx.run_to_finalize(10);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    for id in [6u32, 7] {
        let slot = u64::from(id) * DAY;
        fx.at(30 + u64::from(id) * 10, slot);
        let request = fx.game.start_round(Mode::Solo, None);
        let commitment = protocol::round_commitment(&fx.rule, &ROUND_SALT);
        let begin = near_sdk::serde_json::json!({"commit":commitment,"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
        deliver_env(
            &fx.ctx,
            near_sdk::PromiseResult::Successful(begin.to_string().into_bytes()),
        );
        fx.game.on_begin(request);
        assert_eq!(fx.round()["round_id"], id);
        let play = fx.play(id as u16, "otter");
        fx.verdict(play, 0);
        fx.at(31 + u64::from(id) * 10, slot + INVESTIGATION_END);
        fx.game.advance(Mode::Solo, None);
        let deadline = fx.round()["reveal_deadline_ns"].as_u64().unwrap();
        fx.at(32 + u64::from(id) * 10, deadline);
        let (_, open) = fx.finalize_all();
        let response = fx.open_ok();
        fx.on_open(open, response);
    }
    let season0 = board(&mut fx, Mode::Solo, 0);
    let season1 = board(&mut fx, Mode::Solo, 1);
    assert_eq!(season0.len(), 1);
    assert_eq!(season1.len(), 1);
    assert_eq!(season0[0]["shares"], 1);
    assert_eq!(season1[0]["shares"], 1);
}

#[test]
fn team_dust_and_history_are_independent_of_claims_and_roster_deletion() {
    use near_sdk::{NearToken, PromiseResult, testing_env};
    let mut fx = fixture(params());
    fx.actor("alice.near");
    fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(fx.ctx.build());
    let team = fx.game.create_team("alpha".into());
    for name in ["other.near", "third.near"] {
        fx.actor("alice.near");
        fx.game.invite(name.parse().unwrap());
        fx.actor(name);
        fx.game.join_team(team);
    }
    fx.actor("alice.near");
    fx.ctx.attached_deposit(NearToken::from_yoctonear(40_000));
    testing_env!(fx.ctx.build());
    fx.game.team_deposit(team);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(fx.ctx.build());
    let begin = fx.game.start_round(Mode::Team, None);
    let commitment = protocol::round_commitment(&fx.rule, &ROUND_SALT);
    let response = near_sdk::serde_json::json!({"commit":commitment,"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(response.to_string().into_bytes()),
    );
    fx.game.on_begin(begin);
    let request = match fx.game.play(Mode::Team, 417, "otter".into()) {
        PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    fx.verdict(request, 0);
    fx.at(10, INVESTIGATION_END);
    fx.game.advance(Mode::Team, None);
    let round = serde_json::to_value(fx.game.get_round(Mode::Team, Some(0)).unwrap()).unwrap();
    fx.at(11, round["reveal_deadline_ns"].as_u64().unwrap());
    let open = fx.game.finalize(Mode::Team, None).unwrap();
    let result = fx.open_ok();
    fx.on_open(open, result);
    let before = board(&mut fx, Mode::Team, 0);
    assert_eq!(before.len(), 1);
    assert_eq!(before[0]["earned"], "3198");
    fx.game.settle_team(team);
    for name in ["alice.near", "other.near", "third.near"] {
        fx.actor(name);
        fx.game.leave_team();
        assert_eq!(fx.game.claim_team(Mode::Team, 0, team).0, 1066);
    }
    assert!(fx.game.get_team(team).is_none());
    assert_eq!(board(&mut fx, Mode::Team, 0), before);
}

#[test]
fn skipped_slot_locks_remain_returnable_and_new_locks_target_current_slot() {
    use near_sdk::{NearToken, json_types::U128, testing_env};
    const DAY: u64 = 86_400_000_000_000;
    let mut fx = fixture(params());
    fx.ctx
        .predecessor_account_id("token.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    let message = |id| near_sdk::serde_json::json!({"lock":{"mode":0,"round_id":id}}).to_string();
    assert_eq!(
        fx.game
            .ft_on_transfer("bob.near".parse().unwrap(), U128(50), message(1))
            .0,
        0
    );
    fx.ctx.predecessor_account_id("bob.near".parse().unwrap());
    fx.run_to_finalize(10);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    fx.at(20, 3 * DAY);
    fx.ctx
        .predecessor_account_id("token.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    assert_eq!(
        fx.game
            .ft_on_transfer("bob.near".parse().unwrap(), U128(20), message(3))
            .0,
        0
    );
    assert_eq!(
        fx.game
            .ft_on_transfer("bob.near".parse().unwrap(), U128(20), message(2))
            .0,
        20
    );
    fx.ctx
        .predecessor_account_id("bob.near".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(fx.ctx.build());
    fx.game.unlock(Mode::Solo, 1);
    assert_eq!(
        fx.game
            .get_lock(Mode::Solo, 1, "bob.near".parse().unwrap())
            .0,
        0
    );
    assert_eq!(
        fx.game
            .get_lock(Mode::Solo, 3, "bob.near".parse().unwrap())
            .0,
        20
    );
}

#[test]
fn winner_without_plays_is_indexed_and_stake_is_not_earnings() {
    let mut fx = fixture_seeded(params(), 10_000);
    fx.at(10, 0);
    fx.commit();
    fx.at(12, 1);
    let request = fx.reveal(0);
    fx.answer(request, yes());
    let deadline = fx.round()["reveal_deadline_ns"].as_u64().unwrap();
    fx.at(20, deadline);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    let rows = board(&mut fx, Mode::Solo, 0);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["rounds_won"], 1);
    assert_eq!(rows[0]["shares"], 0);
    assert_eq!(rows[0]["earned"], "4000");
}

#[test]
fn equal_wins_and_shares_order_by_winning_commit_block() {
    const DAY: u64 = 86_400_000_000_000;
    let mut fx = fixture(params());
    let play = fx.play(1, "otter");
    fx.verdict(play, 0);
    fx.at(10, 0);
    fx.commit();
    fx.at(12, 1);
    let guess = fx.reveal(0);
    fx.answer(guess, yes());
    let deadline = fx.round()["reveal_deadline_ns"].as_u64().unwrap();
    fx.at(13, deadline);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);

    fx.actor("carol.near");
    fx.at(20, DAY);
    let begin = fx.game.start_round(Mode::Solo, None);
    let commitment = protocol::round_commitment(&fx.rule, &ROUND_SALT);
    let response = near_sdk::serde_json::json!({"commit":commitment,"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
    deliver_env(
        &fx.ctx,
        near_sdk::PromiseResult::Successful(response.to_string().into_bytes()),
    );
    fx.game.on_begin(begin);
    let play = fx.play(2, "otter");
    fx.verdict(play, 0);
    let hash = protocol::commit_hash(&protocol::CommitPreimage {
        chain: "testnet",
        game: fx.ctx.build().current_account_id.as_str(),
        mode: Mode::Solo,
        round: 1,
        actor: "carol.near",
        entity: protocol::Entity::Solo(1),
        guess: &fx.rule,
        salt: &SALT,
    });
    fx.game.commit_guess(Mode::Solo, hash);
    fx.at(22, DAY + 1);
    let rule_hex = fx.rule_hex();
    let guess = fx
        .game
        .reveal_guess(Mode::Solo, 0, rule_hex, protocol::Hex32(SALT));
    fx.answer(guess, yes());
    let deadline = fx.round()["reveal_deadline_ns"].as_u64().unwrap();
    fx.at(23, deadline);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    let rows = board(&mut fx, Mode::Solo, 0);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["entity_id"], 0);
    assert_eq!(rows[1]["entity_id"], 1);
    assert_eq!(rows[0]["rounds_won"], rows[1]["rounds_won"]);
    assert_eq!(rows[0]["shares"], rows[1]["shares"]);
    assert_eq!(rows[0]["earliest_winning_block"], 10);
    assert_eq!(rows[1]["earliest_winning_block"], 20);
}

#[test]
fn production_start_requires_room_for_full_reveal() {
    use near_sdk::{Gas, test_utils::VMContextBuilder, testing_env};
    const HOUR: u64 = 3_600_000_000_000;
    for delta in [-1i64, 0, 1] {
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut ctx = VMContextBuilder::new();
        ctx.prepaid_gas(Gas::from_tgas(300)).block_timestamp(0);
        testing_env!(ctx.build());
        let mut p = game::params::production_defaults(params());
        p.genesis_ns = 2 * HOUR;
        let cutoff = p.genesis_ns + p.investigation_max_ns;
        let mut game = game::Game::new(p, false);
        ctx.block_timestamp(cutoff.checked_add_signed(delta).unwrap());
        testing_env!(ctx.build());
        if delta <= 0 {
            game.start_round(Mode::Solo, None);
            assert!(game.get_round(Mode::Solo, Some(0)).is_some());
        } else {
            assert!(
                panic_text(|| {
                    game.start_round(Mode::Solo, None);
                })
                .contains("E50")
            );
            assert!(game.get_round(Mode::Solo, Some(0)).is_none());
        }
    }
}

#[test]
fn batch_limit_and_cursor_preserve_all_participants_after_settlement() {
    let mut fx = fixture(params());
    for id in 0..21u16 {
        fx.actor(&format!("participant{id}.near"));
        let request = fx.play(id, "otter");
        fx.verdict(request, 0);
    }
    fx.run_to_finalize(100);
    let (_, open) = fx.finalize_all();
    let response = fx.open_ok();
    fx.on_open(open, response);
    near_sdk::testing_env!(fx.ctx.build());
    let status = serde_json::to_value(fx.game.index_season(Mode::Solo, 0, 20)).unwrap();
    assert_eq!(status["total"], 21);
    assert_eq!(status["indexed"], 20);
    assert_eq!(status["ready"], false);
    assert!(
        panic_text(|| {
            fx.game.get_season(Mode::Solo, 0, None, 200);
        })
        .contains("E50")
    );
    near_sdk::testing_env!(fx.ctx.build());
    let status = serde_json::to_value(fx.game.index_season(Mode::Solo, 0, 20)).unwrap();
    assert_eq!(status["indexed"], 21);
    assert_eq!(status["ready"], true);
    let first = fx.game.get_season(Mode::Solo, 0, None, 20);
    let cursor = serde_json::to_value(first.last().unwrap()).unwrap()["cursor"].clone();
    let last = fx.game.get_season(
        Mode::Solo,
        0,
        Some(serde_json::from_value(cursor).unwrap()),
        20,
    );
    let rows: Vec<Value> = first
        .iter()
        .chain(last.iter())
        .map(|row| serde_json::to_value(row).unwrap())
        .collect();
    let ids: Vec<u64> = rows
        .iter()
        .map(|row| row["entity_id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids, (1..=21).collect::<Vec<_>>());
    for row in rows {
        assert_eq!(row["shares"], 1);
        assert_eq!(row["earned"], "3200");
    }
}
