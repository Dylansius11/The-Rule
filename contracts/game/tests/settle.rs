mod common;

use common::*;
use near_sdk::PromiseResult;
use near_sdk::serde_json::{self, Value};
use proptest::prelude::*;
use protocol::Mode;

const INVESTIGATION_END: u64 = 3_600_000_000_000;
const REVEAL_WINDOW: u64 = 60_000_000_000;
const OPEN_TIMEOUT: u64 = 3_600_000_000_000;

fn round_value(fx: &Fx, key: &str) -> Value {
    fx.round()[key].clone()
}

/// Close Investigation by time and wait out the reveal window.
fn to_finalize(fx: &mut Fx, block: u64) {
    fx.at(block, INVESTIGATION_END);
    fx.game.advance(Mode::Solo);
    let deadline = round_value(fx, "reveal_deadline_ns").as_u64().unwrap();
    fx.at(block + 1, deadline);
}

#[test]
fn solved_round_pays_the_min_seq_winner_contributors_rollover_and_platform() {
    let mut fx = fixture(params());
    let play = fx.play(2, "otter");
    fx.verdict(play, 1);
    fx.actor("carol.near");
    let play = fx.play(3, "otter");
    fx.verdict(play, 1);
    assert_eq!(num(&fx.round()["pot"]), 16_000);

    fx.at(10, 0);
    fx.commit(); // carol, commit_seq 0
    fx.actor("bob.near");
    fx.commit(); // bob, commit_seq 1 (larger seq)
    fx.at(12, 1_000);
    let bob_check = fx.reveal(1);
    fx.actor("carol.near");
    let carol_check = fx.reveal(0);
    // Bob's commit has the larger seq but his callback is applied first: carol still wins.
    fx.actor("bob.near");
    fx.answer(bob_check, yes());
    fx.actor("carol.near");
    fx.answer(carol_check, yes());
    assert_eq!(fx.round()["phase"], "Reveal");

    let deadline = round_value(&fx, "reveal_deadline_ns").as_u64().unwrap();
    fx.at(20, deadline);
    let money = fx.money();
    let platform_before = fx.term("platform_accrued");
    let (calls, open) = fx.finalize_all();
    assert_eq!(calls, 1);
    assert_eq!(fx.round()["phase"], "Opening");
    assert_eq!(fx.round()["open_status"], "pending");
    // Carol committed first, so her commit has the smaller seq and she wins.
    assert_eq!(fx.round()["outcome"]["account"], "carol.near");
    let result = fx.open_ok();
    fx.on_open(open, result);
    let round = fx.round();
    assert_eq!(round["phase"], "Settled");
    assert_eq!(round["open_status"], "ok");
    assert_eq!(
        round["rule"],
        near_sdk::serde_json::to_value(&fx.rule).unwrap()
    );
    // P = 16000: W 6400, C 6400 (two shares of 3200), R 1600, L 1600.
    assert_eq!(fx.term("claimable"), 6_400 + 6_400);
    assert_eq!(fx.term("carry"), 1_600);
    assert_eq!(fx.term("platform_accrued"), platform_before + 1_600);
    assert_eq!(fx.term("round_pots"), 0);
    assert_eq!(fx.money(), money);

    let stake = 160; // 1% of 16000 at commit time
    fx.actor("bob.near");
    let before = fx.credit();
    assert_eq!(fx.claimable("bob.near"), 3_200 + stake);
    assert_eq!(fx.claimable("carol.near"), 6_400 + 3_200 + stake);
    assert_eq!(
        num(&near_sdk::serde_json::to_value(fx.game.claim(Mode::Solo, 0)).unwrap()),
        3_200 + stake
    );
    assert_eq!(fx.credit(), before + 3_200 + stake);
    fx.actor("carol.near");
    let before = fx.credit();
    fx.game.claim(Mode::Solo, 0);
    assert_eq!(fx.credit(), before + 6_400 + 3_200 + stake);
    assert_eq!(fx.term("claimable"), 0);
    assert_eq!(fx.term("open_stakes"), 0);
    assert_eq!(fx.money(), money);
}

#[test]
fn claim_pays_once() {
    let mut fx = fixture(params());
    let play = fx.play(2, "otter");
    fx.verdict(play, 1);
    to_finalize(&mut fx, 10);
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    fx.game.claim(Mode::Solo, 0);
    let again = panic_text(|| {
        fx.game.claim(Mode::Solo, 0);
    });
    assert!(again.contains("E56"), "{again}");
    assert_eq!(fx.claimable("bob.near"), 0);
}

#[test]
fn unsolved_round_rolls_half_over_and_pays_contributors() {
    let mut fx = fixture(params());
    let play = fx.play(2, "otter");
    fx.verdict(play, 1);
    to_finalize(&mut fx, 10);
    let platform_before = fx.term("platform_accrued");
    let (_, open) = fx.finalize_all();
    assert_eq!(fx.round()["outcome"]["kind"], "Unsolved");
    let result = fx.open_ok();
    fx.on_open(open, result);
    // P = 8000: C 3200 (one share), R 4000, L 800.
    assert_eq!(fx.term("claimable"), 3_200);
    assert_eq!(fx.term("carry"), 4_000);
    assert_eq!(fx.term("platform_accrued"), platform_before + 800);
    let before = fx.credit();
    fx.game.claim(Mode::Solo, 0);
    assert_eq!(fx.credit(), before + 3_200);
}

#[test]
fn unsolved_round_without_shares_rolls_the_contributor_part_over_not_to_the_platform() {
    let mut fx = fixture_seeded(params(), 10_000);
    assert_eq!(fx.term("round_pots"), 10_000);
    to_finalize(&mut fx, 10);
    let platform_before = fx.term("platform_accrued");
    let (_, open) = fx.finalize_all();
    let result = fx.open_ok();
    fx.on_open(open, result);
    assert_eq!(fx.term("carry"), 9_000);
    assert_eq!(fx.term("platform_accrued"), platform_before + 1_000);
    assert_eq!(fx.term("claimable"), 0);
    let nothing = panic_text(|| {
        fx.game.claim(Mode::Solo, 0);
    });
    assert!(nothing.contains("E56"), "{nothing}");
}

#[test]
fn unrevealed_commits_are_swept_in_batches_and_treated_as_wrong() {
    let mut fx = fixture(params());
    let players: Vec<String> = (0..25).map(|i| format!("p{i}.near")).collect();
    fx.at(10, 0);
    for name in &players {
        fx.actor(name);
        fx.commit();
    }
    let staked = fx.term("open_stakes");
    assert_eq!(staked, 25 * 100);
    let money = fx.money();
    to_finalize(&mut fx, 20);
    let credit_before = credit_of(&fx.game, "p0.near");
    let (calls, open) = fx.finalize_all();
    assert_eq!(calls, 2, "25 commits need two batches of 20");
    assert_eq!(fx.term("open_stakes"), 0);
    assert!(fx.commits().iter().all(|c| status(c) == "Unrevealed"));
    assert_eq!(credit_of(&fx.game, "p0.near"), credit_before + 50);
    assert_eq!(fx.term("round_pots"), 25 * 50);
    assert_eq!(fx.money(), money);
    let result = fx.open_ok();
    fx.on_open(open, result);
    // P = 1250, no shares: C 500 rolls over with R 625, L 125 -> carry 1125.
    assert_eq!(fx.term("carry"), 1_125);
    assert_eq!(fx.term("platform_accrued"), 125);
    assert_eq!(fx.money(), money);
}

#[test]
fn a_mismatched_opening_voids_the_round_and_refunds_every_contribution() {
    let mut fx = fixture(params());
    let play = fx.play(2, "otter");
    fx.verdict(play, 1);
    fx.at(10, 0);
    fx.commit(); // bob, commit_seq 0
    fx.actor("carol.near");
    fx.commit(); // carol, commit_seq 1
    fx.at(12, 0);
    let correct = {
        fx.actor("bob.near");
        fx.reveal(0)
    };
    fx.answer(correct, yes());
    fx.actor("carol.near");
    let wrong = fx.reveal(1);
    fx.answer(wrong, no());
    // Carol's 100 stake: 50 back at once, 50 into the pot.
    assert_eq!(fx.term("round_pots"), 8_000 + 50);

    let money = fx.money();
    let deadline = round_value(&fx, "reveal_deadline_ns").as_u64().unwrap();
    fx.at(20, deadline);
    let (_, open) = fx.finalize_all();
    let bad = fx.open_with([4; 32]);
    fx.on_open(open, bad);
    assert_eq!(fx.round()["phase"], "Void");
    assert_eq!(fx.round()["rule"], Value::Null);
    assert_eq!(fx.term("carry"), 0);
    assert_eq!(fx.term("claimable"), 8_050);
    assert_eq!(fx.money(), money);
    // Void refunds: bob his fee share and his stake, carol the half of her stake that went to the pot.
    assert_eq!(fx.claimable("bob.near"), 8_000 + 100);
    assert_eq!(fx.claimable("carol.near"), 50);
    let before = fx.credit();
    fx.game.claim(Mode::Solo, 0);
    assert_eq!(fx.credit(), before + 50);
    fx.actor("bob.near");
    let before = fx.credit();
    fx.game.claim(Mode::Solo, 0);
    assert_eq!(fx.credit(), before + 8_100);
    assert_eq!(fx.term("claimable"), 0);
    assert_eq!(fx.term("open_stakes"), 0);
    assert_eq!(fx.money(), money);
}

#[test]
fn a_failed_open_can_be_retried_and_cannot_be_cancelled_early() {
    let mut fx = fixture(params());
    let play = fx.play(2, "otter");
    fx.verdict(play, 1);
    to_finalize(&mut fx, 10);
    let (_, open) = fx.finalize_all();
    fx.on_open(open, PromiseResult::Failed);
    let round = fx.round();
    assert_eq!(round["phase"], "Opening");
    assert_eq!(round["open_status"], "failed");
    let early = panic_text(|| fx.game.cancel(Mode::Solo, 0));
    assert!(early.contains("E50"), "{early}");
    let retry = fx.game.retry_open(Mode::Solo, 0);
    assert_eq!(fx.round()["open_status"], "pending");
    let result = fx.open_ok();
    fx.on_open(retry, result);
    assert_eq!(fx.round()["phase"], "Settled");
    // A late duplicate of the first callback changes nothing.
    fx.on_open(open, PromiseResult::Failed);
    assert_eq!(fx.round()["phase"], "Settled");
}

#[test]
fn an_open_that_keeps_failing_is_cancelled_after_the_timeout_and_refunds() {
    let mut fx = fixture_seeded(params(), 5_000);
    let play = fx.play(2, "otter");
    fx.verdict(play, 1);
    to_finalize(&mut fx, 10);
    let money = fx.money();
    let started = {
        let (_, open) = fx.finalize_all();
        fx.on_open(open, PromiseResult::Failed);
        round_value(&fx, "opening_started_ns").as_u64().unwrap()
    };
    fx.at(30, started + OPEN_TIMEOUT);
    let retry = panic_text(|| {
        fx.game.retry_open(Mode::Solo, 0);
    });
    assert!(retry.contains("E50"), "{retry}");
    fx.game.cancel(Mode::Solo, 0);
    assert_eq!(fx.round()["phase"], "Cancelled");
    // Seed returns to carry; the fee share is claimable by whoever paid it.
    assert_eq!(fx.term("carry"), 5_000);
    assert_eq!(fx.claimable("bob.near"), 8_000);
    let before = fx.credit();
    fx.game.claim(Mode::Solo, 0);
    assert_eq!(fx.credit(), before + 8_000);
    assert_eq!(fx.money(), money);
}

#[test]
fn finalize_and_claim_enforce_phase_deadline_and_pending_checks() {
    let mut fx = fixture(params());
    let early = panic_text(|| {
        fx.game.finalize(Mode::Solo);
    });
    assert!(early.contains("E10"), "{early}");
    let unfinished = panic_text(|| {
        fx.game.claim(Mode::Solo, 0);
    });
    assert!(unfinished.contains("E10"), "{unfinished}");

    fx.at(10, 0);
    fx.commit();
    fx.at(12, 0);
    let check = fx.reveal(0);
    fx.at(14, INVESTIGATION_END);
    fx.game.advance(Mode::Solo);
    let too_early = panic_text(|| {
        fx.game.finalize(Mode::Solo);
    });
    assert!(too_early.contains("E50"), "{too_early}");
    fx.at(15, INVESTIGATION_END + REVEAL_WINDOW);
    let pending = panic_text(|| {
        fx.game.finalize(Mode::Solo);
    });
    assert!(
        pending.contains("E50"),
        "pending check blocks finalize: {pending}"
    );
    fx.answer(check, no());
    fx.finalize_all();
    let stranger = {
        fx.actor("carol.near");
        panic_text(|| {
            fx.game.claim(Mode::Solo, 0);
        })
    };
    assert!(stranger.contains("E10"), "{stranger}");
}

#[test]
fn platform_share_is_sent_once_and_restored_when_the_transfer_fails() {
    let mut fx = fixture(params());
    let play = fx.play(2, "otter");
    fx.verdict(play, 1);
    let accrued = fx.term("platform_accrued");
    assert_eq!(accrued, 500);
    let money = fx.money();
    let request = fx.game.claim_platform();
    assert_eq!(fx.term("platform_accrued"), 0);
    let twice = panic_text(|| {
        fx.game.claim_platform();
    });
    assert!(twice.contains("E56"), "{twice}");
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_platform(request);
    assert_eq!(fx.term("platform_accrued"), accrued);
    assert_eq!(fx.money(), money);
    // A transfer that succeeded stays sent, and a duplicate callback does nothing.
    let request = fx.game.claim_platform();
    deliver_env(&fx.ctx, PromiseResult::Successful(Vec::new()));
    fx.game.on_platform(request);
    deliver_env(&fx.ctx, PromiseResult::Failed);
    fx.game.on_platform(request);
    assert_eq!(fx.term("platform_accrued"), 0);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(120))]
    #[test]
    fn every_ending_conserves_money_and_empties_claimables(
        ops in prop::collection::vec((0u8..3, 0u8..3, 0u8..3), 1..30),
        ending in 0u8..3,
    ) {
        let names = ["bob.near", "a1.near", "a2.near"];
        let mut fx = fixture_seeded(params(), 3_000);
        for name in &names[1..] {
            fx.actor(name);
        }
        let mut block = 10u64;
        for (n, (who, op, result)) in ops.into_iter().enumerate() {
            block += 3;
            fx.at(block, 1_000 + block);
            fx.actor(names[usize::from(who)]);
            if fx.round()["phase"] != "Investigation" {
                break;
            }
            let me = fx.me();
            match op {
                0 => {
                    let request = fx.play(u16::try_from(n + 1).unwrap(), "otter");
                    fx.verdict(request, result % 2);
                }
                1 => {
                    let open = fx
                        .commits()
                        .iter()
                        .filter(|c| c["actor"] == me.as_str() && matches!(status(c), "Committed" | "Checking" | "Correct"))
                        .count();
                    if open < 3 {
                        fx.commit();
                    }
                }
                _ => {
                    let target = fx
                        .commits()
                        .iter()
                        .find(|c| c["actor"] == me.as_str() && status(c) == "Committed")
                        .map(|c| u32::try_from(c["commit_seq"].as_u64().unwrap()).unwrap());
                    if let Some(seq) = target {
                        let request = fx.reveal(seq);
                        let answer = match result {
                            0 => yes(),
                            1 => no(),
                            _ => PromiseResult::Failed,
                        };
                        fx.answer(request, answer);
                    }
                }
            }
        }
        block += 3;
        if fx.round()["phase"] == "Investigation" {
            fx.at(block, INVESTIGATION_END);
            fx.game.advance(Mode::Solo);
        }
        let deadline = round_value(&fx, "reveal_deadline_ns").as_u64().unwrap();
        fx.at(block + 3, deadline);
        let money = fx.money();
        let (_, open) = fx.finalize_all();
        prop_assert_eq!(fx.money(), money);
        match ending {
            0 => {
                let result = fx.open_ok();
                fx.on_open(open, result);
                prop_assert!(fx.round()["phase"] == "Settled");
            }
            1 => {
                let bad = fx.open_with([9; 32]);
                fx.on_open(open, bad);
                prop_assert!(fx.round()["phase"] == "Void");
            }
            _ => {
                fx.on_open(open, PromiseResult::Failed);
                let started = round_value(&fx, "opening_started_ns").as_u64().unwrap();
                fx.at(block + 6, started + OPEN_TIMEOUT);
                fx.game.cancel(Mode::Solo, 0);
                prop_assert!(fx.round()["phase"] == "Cancelled");
            }
        }
        prop_assert_eq!(fx.money(), money);
        for name in names {
            fx.actor(name);
            let owed = fx.claimable(name);
            if owed > 0 {
                let credit = fx.credit();
                fx.game.claim(Mode::Solo, 0);
                prop_assert_eq!(fx.credit(), credit + owed);
            }
            prop_assert_eq!(fx.claimable(name), 0);
        }
        prop_assert_eq!(fx.term("claimable"), 0);
        prop_assert_eq!(fx.term("open_stakes"), 0);
        prop_assert_eq!(fx.term("round_pots"), 0);
        prop_assert_eq!(fx.money(), money);
    }
}

#[test]
fn lifecycle_phase_guards_reject_without_changing_round_or_money() {
    for phase in [
        "Investigation",
        "Reveal",
        "Opening",
        "Settled",
        "Void",
        "Cancelled",
    ] {
        let mut fx = fixture(params());
        if phase != "Investigation" {
            fx.run_to_finalize(10);
            if phase == "Reveal" {
                fx.at(11, INVESTIGATION_END + REVEAL_WINDOW - 1);
            } else {
                let (_, open) = fx.finalize_all();
                match phase {
                    "Settled" => fx.on_open(open, fx.open_ok()),
                    "Void" => fx.on_open(open, fx.open_with([9; 32])),
                    "Cancelled" => {
                        fx.on_open(open, PromiseResult::Failed);
                        let started = fx.round()["opening_started_ns"].as_u64().unwrap();
                        fx.at(12, started + OPEN_TIMEOUT);
                        fx.game.cancel(Mode::Solo, 0);
                    }
                    _ => {}
                }
            }
        }
        assert_eq!(fx.round()["phase"], phase);
        for method in [
            "start_round",
            "advance",
            "finalize",
            "retry_open",
            "cancel",
            "play",
            "commit_guess",
        ] {
            if phase == "Investigation" && matches!(method, "play" | "commit_guess") {
                continue;
            }
            near_sdk::testing_env!(fx.ctx.build());
            let before = (fx.round(), fx.ledger(), fx.commits());
            let error = panic_text(|| match method {
                "start_round" => {
                    fx.game.start_round(Mode::Solo);
                }
                "advance" => fx.game.advance(Mode::Solo),
                "finalize" => {
                    fx.game.finalize(Mode::Solo);
                }
                "retry_open" => {
                    fx.game.retry_open(Mode::Solo, 0);
                }
                "cancel" => fx.game.cancel(Mode::Solo, 0),
                "play" => {
                    fx.game.play(Mode::Solo, 1, "otter".into());
                }
                "commit_guess" => {
                    fx.game.commit_guess(Mode::Solo, protocol::Hex32([0; 32]));
                }
                _ => unreachable!(),
            });
            let expected = match (phase, method) {
                ("Investigation", "advance")
                | ("Reveal", "finalize")
                | ("Opening" | "Settled" | "Void" | "Cancelled", "start_round")
                | ("Opening", "cancel") => "E50",
                _ => "E10",
            };
            assert!(error.contains(expected), "{phase}/{method}: {error}");
            assert_eq!(
                (fx.round(), fx.ledger(), fx.commits()),
                before,
                "{phase}/{method}"
            );
            assert!(
                near_sdk::test_utils::get_created_receipts().is_empty(),
                "{phase}/{method}"
            );
        }
    }
}

#[test]
fn solo_and_team_slots_reject_before_boundary_then_admit_exactly_once() {
    use game::Game;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    for mode in [Mode::Solo, Mode::Team] {
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        let mut p = params();
        p.genesis_ns = 100;
        p.mode_offset_ns = [7, 13];
        let due = p.genesis_ns + p.mode_offset_ns[mode as usize];
        let mut ctx = VMContextBuilder::new();
        ctx.prepaid_gas(near_sdk::Gas::from_tgas(300))
            .block_timestamp(due - 1);
        testing_env!(ctx.build());
        let mut game = Game::new(p, true);
        let before = serde_json::to_value(game.get_ledger()).unwrap();
        assert!(
            panic_text(|| {
                game.start_round(mode);
            })
            .contains("E50")
        );
        assert!(game.get_round(mode, None).is_none());
        assert_eq!(serde_json::to_value(game.get_ledger()).unwrap(), before);
        assert!(near_sdk::test_utils::get_created_receipts().is_empty());
        ctx.block_timestamp(due);
        testing_env!(ctx.build());
        game.start_round(mode);
        let admitted = serde_json::to_value(game.get_round(mode, None).unwrap()).unwrap();
        assert_eq!(admitted["slot_ns"], due);
        assert_eq!(admitted["phase"], "Sealing");
        testing_env!(ctx.build());
        assert!(
            panic_text(|| {
                game.start_round(mode);
            })
            .contains("E50")
        );
        assert_eq!(
            serde_json::to_value(game.get_round(mode, None).unwrap()).unwrap(),
            admitted
        );
        assert!(near_sdk::test_utils::get_created_receipts().is_empty());
    }
}
