//! Solo-only modeled cash conservation. The native VM does not execute receipts or update its
//! account balance: outbound actions and failed-transfer refunds are modeled explicitly here.
//! The tiny fixture storage charges are useful for conservation, not a storage-solvency proof.
//! Scope: currently implemented Solo money-changing paths only; Team and token paths are excluded.
//! This principal-only model excludes gas and is not an observed chain balance.
mod common;

use common::*;
use near_sdk::{NearToken, PromiseResult, json_types::U128, mock::MockAction, testing_env};
use proptest::{
    prelude::*,
    test_runner::{Config, RngAlgorithm, TestRng, TestRunner},
};
use protocol::Mode;
use std::cell::Cell;

const NAMES: [&str; 4] = ["bob.near", "carol.near", "dave.near", "erin.near"];
const COMPUTE: u128 = 1_000;
const OPEN_TIMEOUT: u64 = 3_600_000_000_000;

/// Cash is obtained only from externally supplied inputs and actual created outbound actions,
/// not from a ledger total. Escrow is the unresolved payment-transfer exposure. The model
/// credits failed-transfer principal at the failure-callback boundary; actual receipt
/// ordering between a refund and that callback is not modeled.
#[derive(Default)]
struct Cash {
    inputs: u128,
    paid: u128,
    balance: u128,
    escrow: u128,
    compute_spent: u128,
    surplus: u128, // one-yocto authorization deposits, not recorded by the ledger
}

impl Cash {
    fn incoming(&mut self, amount: u128) {
        self.inputs += amount;
        self.balance += amount;
    }

    fn outbound(&mut self) -> u128 {
        let mut transfers = 0;
        for receipt in near_sdk::test_utils::get_created_receipts() {
            for action in receipt.actions {
                match action {
                    MockAction::Transfer { deposit, .. } => {
                        let amount = deposit.as_yoctonear();
                        self.balance -= amount;
                        self.escrow += amount;
                        transfers += amount;
                    }
                    MockAction::FunctionCallWeight {
                        attached_deposit, ..
                    } => {
                        let amount = attached_deposit.as_yoctonear();
                        self.balance -= amount;
                        self.compute_spent += amount;
                    }
                    _ => {}
                }
            }
        }
        transfers
    }

    fn complete(&mut self, amount: u128, failed: bool) {
        self.escrow -= amount;
        if failed {
            self.balance += amount;
        } else {
            self.paid += amount;
        }
    }

    fn check(&self, fx: &Fx) {
        let ledger = fx.ledger();
        let tracked: u128 = [
            "credit",
            "vault",
            "round_pots",
            "carry",
            "open_stakes",
            "claimable",
            "compute_float",
            "platform_accrued",
            "storage_reserve",
            "pending_credit",
        ]
        .iter()
        .map(|key| num(&ledger[key]))
        .sum();
        // Payments leave modeled spendable balance at receipt creation. Escrow remains
        // exposed until the selected receipt result, independently of ledger liabilities.
        assert_eq!(self.balance, tracked + self.surplus);
        assert_eq!(
            self.inputs,
            self.balance + self.escrow + self.compute_spent + self.paid
        );
        let players: u128 = NAMES
            .iter()
            .filter_map(|name| {
                fx.game
                    .get_player(name.parse().unwrap())
                    .map(|player| num(&player["credit"]))
            })
            .sum();
        assert_eq!(num(&ledger["credit"]), players, "aggregate player credit");
        if matches!(
            fx.round()["phase"].as_str(),
            Some("Settled" | "Void" | "Cancelled")
        ) {
            let owed: u128 = NAMES.iter().map(|name| fx.claimable(name)).sum();
            assert_eq!(
                owed,
                num(&ledger["claimable"]) + num(&ledger["open_stakes"]),
                "per-account terminal payout and correct-stake reconciliation"
            );
        }
        // locked_storage is deliberately not added to storage_reserve: these tiny native
        // charges do not cover real byte collateral, and VM balance is not receipt-driven.
    }
}

fn reset(fx: &Fx) {
    testing_env!(fx.ctx.build());
}
fn response(failed: bool) -> PromiseResult {
    if failed {
        PromiseResult::Failed
    } else {
        PromiseResult::Successful(Vec::new())
    }
}
fn callback_id(method: &str) -> u64 {
    calls()
        .into_iter()
        .find(|(_, name, _, _)| name == method)
        .unwrap()
        .2["request_id"]
        .as_u64()
        .unwrap()
}

/// Each generated case has mandatory coverage of overlap and each stake status; bits vary
/// callback ordering, successful/failed transfers, verdicts, and the ending.
fn run_case(bits: u32, ending: u8, seed: u128, topup: u128, withdrawal_amount: u128, extra: &[u8]) {
    let mut p = params();
    p.outlayer_deposit.verdict.0 = 3;
    p.outlayer_deposit.guess.0 = 5;
    p.outlayer_deposit.open.0 = 7;
    let mut fx = fixture_seeded(p, seed);
    let mut cash = Cash::default();
    cash.incoming(DEPOSIT + seed); // fixture's explicit deposit_credit and seed_pot inputs
    cash.check(&fx);
    for name in &NAMES[1..] {
        fx.actor(name);
        cash.incoming(fx.ctx.build().attached_deposit.as_yoctonear());
        cash.check(&fx);
    }
    fx.actor(NAMES[0]);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(topup));
    reset(&fx);
    fx.game.deposit_credit();
    cash.incoming(fx.ctx.build().attached_deposit.as_yoctonear());
    cash.check(&fx);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(COMPUTE));
    reset(&fx);
    fx.game.fund_compute();
    cash.incoming(fx.ctx.build().attached_deposit.as_yoctonear());
    cash.check(&fx);

    // Two settled plays give two distinct contributors. Callback result can be YES or NO.
    for (i, name) in NAMES[..2].iter().enumerate() {
        fx.actor(name);
        reset(&fx);
        let request = fx.play((i + 1) as u16, "otter");
        assert_eq!(cash.outbound(), 0);
        assert_eq!(fx.term("pending_credit"), 10_100);
        assert_eq!(cash.compute_spent, (i as u128 + 1) * 3);
        cash.check(&fx);
        fx.verdict(request, ((bits >> i) & 1) as u8);
        cash.check(&fx);
        fx.verdict(request, 1); // duplicate callback is a no-op
        cash.check(&fx);
    }
    // Erin has no prior play, so her same-key play is a free known verdict.
    fx.actor(NAMES[3]);
    reset(&fx);
    assert!(matches!(
        fx.game.play(Mode::Solo, 1, "otter".into()),
        game::PlayAck::Known { .. }
    ));
    assert_eq!(cash.outbound(), 0);
    cash.check(&fx);
    let mut shares = 2u128;
    for (i, outcome) in extra.iter().copied().enumerate() {
        fx.actor(NAMES[i % 2]);
        reset(&fx);
        let request = fx.play(100 + i as u16, "otter");
        assert_eq!(cash.outbound(), 0);
        cash.check(&fx);
        if outcome == 0 {
            deliver_env(&fx.ctx, PromiseResult::Failed);
            fx.game.on_verdict(request);
        } else {
            fx.verdict(request, outcome % 2);
            shares += 1;
        }
        cash.check(&fx);
    }
    let extra_count = extra.len() as u128;

    fx.at(10, 0);
    // An in-flight first play and a commit share Dave's new entity. Its failure must not
    // discard that commitment; some cases deliver it after freeze instead.
    fx.actor(NAMES[2]);
    reset(&fx);
    let pending = fx.play(3, "otter");
    cash.outbound();
    assert_eq!(fx.term("pending_credit"), 10_100);
    assert_eq!(cash.compute_spent, 9 + extra_count * 3);
    cash.check(&fx);
    for name in NAMES {
        fx.actor(name);
        fx.commit();
        cash.check(&fx);
    }
    fx.at(12, 1);
    let mut checks = [0; 3];
    for i in 0..3 {
        fx.actor(NAMES[i]);
        checks[i] = fx.reveal(i as u32);
        cash.outbound();
        assert_eq!(
            cash.compute_spent,
            9 + extra_count * 3 + (i as u128 + 1) * 5
        );
        cash.check(&fx);
    }
    // A withdrawal and a platform payment may overlap with the outstanding referee calls.
    fx.actor(NAMES[3]);
    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
    reset(&fx);
    fx.game.withdraw_credit(U128(withdrawal_amount));
    cash.incoming(fx.ctx.build().attached_deposit.as_yoctonear());
    cash.surplus += 1;
    let withdrawal = callback_id("on_withdraw");
    assert_eq!(cash.outbound(), withdrawal_amount);
    cash.check(&fx);
    reset(&fx);
    let platform = fx.game.claim_platform();
    let platform_amount = cash.outbound();
    assert_eq!(platform_amount, shares * 500);
    cash.check(&fx);

    // Resolve before checks in half the cases to exercise entity/commit overlap.
    // Otherwise leave it pending across the freeze and deliver a valid late verdict.
    if bits & 128 == 0 {
        deliver_env(&fx.ctx, PromiseResult::Failed);
        fx.game.on_verdict(pending);
        cash.check(&fx);
        fx.verdict(pending, 1);
        cash.check(&fx);
    }
    // All reveals are already in flight. Either Bob or Dave can be the correct guesser;
    // the other is failed when Dave wins. Erin's fourth commit remains unrevealed.
    let order = if bits & 4 == 0 { [0, 1, 2] } else { [2, 1, 0] };
    for i in order {
        let dave_correct = bits & 8 != 0 && bits & 64 != 0;
        let answer = if (i == 2 && !dave_correct) || (i == 0 && dave_correct) {
            PromiseResult::Failed
        } else if (i == 0 && bits & 8 != 0) || (i == 2 && dave_correct) {
            yes()
        } else {
            no()
        };
        fx.answer(checks[i], answer);
        cash.check(&fx);
        fx.answer(checks[i], yes());
        cash.check(&fx);
    }
    if bits & 128 != 0 {
        if bits & 8 != 0 {
            fx.verdict(pending, 1); // frozen round must refund rather than settle the play
        } else {
            deliver_env(&fx.ctx, PromiseResult::Failed);
            fx.game.on_verdict(pending);
        }
        cash.check(&fx);
        fx.verdict(pending, 1);
        cash.check(&fx);
    }

    let withdraw_failed = bits & 16 != 0;
    cash.complete(withdrawal_amount, withdraw_failed);
    deliver_env(&fx.ctx, response(withdraw_failed));
    fx.game.on_withdraw(withdrawal);
    cash.check(&fx);
    deliver_env(&fx.ctx, response(!withdraw_failed));
    fx.game.on_withdraw(withdrawal);
    cash.check(&fx);
    let platform_failed = bits & 32 != 0;
    cash.complete(platform_amount, platform_failed);
    deliver_env(&fx.ctx, response(platform_failed));
    fx.game.on_platform(platform);
    cash.check(&fx);
    deliver_env(&fx.ctx, response(!platform_failed));
    fx.game.on_platform(platform);
    cash.check(&fx);

    if fx.round()["phase"] == "Investigation" {
        fx.at(20, INVESTIGATION_END);
        fx.game.advance(Mode::Solo);
        cash.check(&fx);
    }
    let deadline = fx.round()["reveal_deadline_ns"].as_u64().unwrap();
    fx.at(21, deadline);
    reset(&fx);
    let open = fx.game.finalize(Mode::Solo).unwrap();
    cash.outbound();
    assert_eq!(cash.compute_spent, 31 + extra_count * 3);
    cash.check(&fx);
    let pot = num(&fx.round()["pot"]);
    let solved = fx.round()["outcome"]["kind"] == "Solved";
    let before_platform = fx.term("platform_accrued");
    let before_claimable = fx.term("claimable");
    let before_carry = fx.term("carry");
    match ending {
        0 => {
            let result = fx.open_ok();
            fx.on_open(open, result);
            assert_eq!(fx.round()["phase"], "Settled");
            // I2: independently counted successful unique plays each create one share.
            // Integer remainder (including contributor division dust) belongs to rollover.
            let winner = if solved { pot * 4_000 / 10_000 } else { 0 };
            let contributors = pot * 4_000 / 10_000;
            let paid = (contributors / shares) * shares;
            let platform = pot / 10;
            let rollover = pot - winner - paid - platform;
            assert_eq!(fx.term("claimable") - before_claimable, winner + paid);
            assert_eq!(fx.term("platform_accrued") - before_platform, platform);
            assert_eq!(fx.term("carry") - before_carry, rollover);
            assert_eq!(winner + paid + platform + rollover, pot);
        }
        1 => {
            let result = fx.open_with([4; 32]);
            fx.on_open(open, result);
            assert_eq!(fx.round()["phase"], "Void");
            assert_eq!(fx.term("carry") - before_carry, seed);
            assert_eq!(fx.term("claimable") - before_claimable, pot - seed);
        }
        _ => {
            fx.on_open(open, PromiseResult::Failed);
            cash.check(&fx);
            let started = fx.round()["opening_started_ns"].as_u64().unwrap();
            fx.at(22, started + OPEN_TIMEOUT);
            fx.game.cancel(Mode::Solo, 0);
            assert_eq!(fx.round()["phase"], "Cancelled");
            assert_eq!(fx.term("carry") - before_carry, seed);
            assert_eq!(fx.term("claimable") - before_claimable, pot - seed);
        }
    }
    cash.check(&fx);
    fx.on_open(open, PromiseResult::Failed);
    cash.check(&fx);
    for name in NAMES {
        fx.actor(name);
        if fx.claimable(name) > 0 {
            fx.game.claim(Mode::Solo, 0);
            cash.check(&fx);
        }
    }
    assert_eq!(fx.term("claimable"), 0);
    assert_eq!(fx.term("open_stakes"), 0);
    assert_eq!(fx.term("round_pots"), 0);
    assert_eq!(cash.escrow, 0);
}

#[test]
fn solo_cash_and_pot_partition_seeded_sequences() {
    // Keep the regular suite bounded; P3.3's extended run uses PROPTEST_CASES=10000.
    let config = Config {
        failure_persistence: None,
        ..Config::default()
    };
    let rng = TestRng::from_seed(RngAlgorithm::ChaCha, &[0x51; 32]);
    let mut runner = TestRunner::new_with_rng(config, rng);
    let endings = [Cell::new(0u32), Cell::new(0u32), Cell::new(0u32)];
    let solved = [Cell::new(0u32), Cell::new(0u32)];
    let strategy = (
        any::<u32>(),
        0u8..3,
        1u128..10_000,
        1u128..50_000,
        1u128..50_000,
        prop::collection::vec(0u8..4, 0..9),
    );
    runner
        .run(
            &strategy,
            |(bits, ending, seed, topup, withdrawal_amount, extra)| {
                run_case(bits, ending, seed, topup, withdrawal_amount, &extra);
                endings[usize::from(ending)].set(endings[usize::from(ending)].get() + 1);
                let outcome = usize::from(bits & 8 != 0);
                solved[outcome].set(solved[outcome].get() + 1);
                Ok(())
            },
        )
        .unwrap();
    assert!(endings.iter().all(|n| n.get() > 0));
    assert!(solved.iter().all(|n| n.get() > 0));
    println!(
        "seeded sequences={} endings={:?} unsolved_solved={:?}",
        endings.iter().map(Cell::get).sum::<u32>(),
        endings.map(|n| n.get()),
        solved.map(|n| n.get())
    );
}
