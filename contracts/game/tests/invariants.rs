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

/// The VM does not execute native transfers. Model both admissible refund/callback
/// orders, and keep unrelated payments pending until their own authenticated callbacks.
#[test]
fn seeded_native_payment_refund_order_and_owner_reservations() {
    const COLLATERAL: u128 = 10u128.pow(27);
    const ORDERS: [[usize; 3]; 6] = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ];
    let config = Config {
        failure_persistence: None,
        ..Config::default()
    };
    let mut runner = TestRunner::new_with_rng(
        config,
        TestRng::from_seed(RngAlgorithm::ChaCha, &[0xa4; 32]),
    );
    runner
        .run(
            &(1u128..50_000, 1u128..50_000, any::<u8>(), 0usize..6),
            |(bob_amount, carol_amount, bits, order)| {
                let mut fx = fixture(params());
                fx.actor(NAMES[1]);
                fx.actor(NAMES[0]);
                let play = fx.play(1, "otter");
                fx.verdict(play, 0);
                let mut cash = Cash::default();
                cash.incoming(2 * DEPOSIT);
                let mut credits = [DEPOSIT - 10_200, DEPOSIT - 100];
                let mut platform = 500u128;
                // One NO play contributes 8,000 pot + 1,500 compute; two account
                // registrations and the play contribute 300 storage reserve.
                // Locked storage is not an additional liability in storage.rs.
                let other = 8_000 + 1_500 + 300;
                let amounts = [bob_amount, carol_amount, platform];
                let mut ids = [0u64; 3];
                let mut reserved = 0u128;
                for i in 0..3 {
                    fx.actor(NAMES[i.min(1)]);
                    fx.ctx
                        .attached_deposit(NearToken::from_yoctonear(u128::from(i < 2)));
                    reset(&fx);
                    if i < 2 {
                        fx.game.withdraw_credit(U128(amounts[i]));
                        cash.incoming(1);
                        cash.surplus += 1;
                        credits[i] -= amounts[i];
                        ids[i] = callback_id("on_withdraw");
                    } else {
                        ids[i] = fx.game.claim_platform();
                        platform = 0;
                    }
                    let receipts = near_sdk::test_utils::get_created_receipts();
                    let transfer = receipts
                        .iter()
                        .find(|r| {
                            r.actions
                                .iter()
                                .any(|a| matches!(a, MockAction::Transfer { .. }))
                        })
                        .unwrap();
                    let receiver = if i < 2 { NAMES[i] } else { "platform.testnet" };
                    assert_eq!(transfer.receiver_id.as_str(), receiver);
                    assert_eq!(cash.outbound(), amounts[i]);
                    reserved += amounts[i];
                }
                let check = |fx: &mut Fx,
                             cash: &Cash,
                             credits: [u128; 2],
                             platform: u128,
                             reserved: u128| {
                    fx.ctx
                        .account_balance(NearToken::from_yoctonear(COLLATERAL + cash.balance))
                        .attached_deposit(NearToken::from_yoctonear(0));
                    reset(fx);
                    let ledger = fx.ledger();
                    assert_eq!(credit_of(&fx.game, NAMES[0]), credits[0]);
                    assert_eq!(credit_of(&fx.game, NAMES[1]), credits[1]);
                    assert_eq!(num(&ledger["credit"]), credits.iter().sum::<u128>());
                    assert_eq!(num(&ledger["platform_accrued"]), platform);
                    assert_eq!(num(&ledger["pending_native_payments"]), reserved);
                    assert_eq!(
                        num(&ledger["operator_storage_available"]),
                        (COLLATERAL + cash.balance).saturating_sub(
                            other + credits.iter().sum::<u128>() + platform + reserved
                        )
                    );
                    assert_eq!(cash.inputs, cash.balance + cash.escrow + cash.paid);
                };
                check(&mut fx, &cash, credits, platform, reserved);
                for name in &NAMES[..2] {
                    fx.actor(name);
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                    reset(&fx);
                    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
                    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
                    check(&mut fx, &cash, credits, platform, reserved);
                }
                deliver_env(&fx.ctx, response(true));
                fx.game.on_platform(ids[0]);
                fx.game.on_withdraw(ids[2]);
                check(&mut fx, &cash, credits, platform, reserved);
                // Elapsed time does not establish an outcome or release a payment reservation.
                fx.at(50, OPEN_TIMEOUT * 2);
                for id in ids {
                    assert!(!fx.game.expire_request(id));
                }
                check(&mut fx, &cash, credits, platform, reserved);
                for i in ORDERS[order] {
                    let failed = bits & (1 << i) != 0;
                    let refund_first = bits & (1 << (i + 3)) != 0;
                    if !failed || refund_first {
                        cash.complete(amounts[i], failed);
                        check(&mut fx, &cash, credits, platform, reserved);
                    }
                    deliver_env(&fx.ctx, response(failed));
                    if i < 2 {
                        fx.game.on_withdraw(ids[i]);
                        if failed {
                            credits[i] += amounts[i];
                        }
                    } else {
                        fx.game.on_platform(ids[i]);
                        if failed {
                            platform += amounts[i];
                        }
                    }
                    reserved -= amounts[i];
                    check(&mut fx, &cash, credits, platform, reserved);
                    if failed && !refund_first {
                        cash.complete(amounts[i], true);
                        check(&mut fx, &cash, credits, platform, reserved);
                    }
                    deliver_env(&fx.ctx, response(!failed));
                    if i < 2 {
                        fx.game.on_withdraw(ids[i]);
                    } else {
                        fx.game.on_platform(ids[i]);
                    }
                    check(&mut fx, &cash, credits, platform, reserved);
                }
                Ok(())
            },
        )
        .unwrap();
}

/// This model tracks the owner's spendable credit separately from transfer escrow.
/// The mock VM does not execute transfers, so `Cash` accounts for the actual actions.
struct Overlap {
    cash: Cash,
    credit: u128,
    reserved: u128,
    returned_unresolved: u128,
    pending_play: bool,
    pending_withdrawal: bool,
    attempts: u64,
    shares: u64,
}

impl Overlap {
    fn check(&self, fx: &Fx) {
        let player = fx.game.get_player(NAMES[0].parse().unwrap()).unwrap();
        assert_eq!(num(&player["credit"]), self.credit);
        assert_eq!(player["pending_play"], self.pending_play);
        assert_eq!(player["pending_withdrawal"], self.pending_withdrawal);
        assert_eq!(fx.term("credit"), self.credit);
        assert_eq!(fx.term("pending_native_payments"), self.reserved);
        assert_eq!(
            fx.term("pending_credit"),
            if self.pending_play { 10_100 } else { 0 }
        );
        let entity = near_sdk::serde_json::to_value(fx.game.get_entity(
            Mode::Solo,
            0,
            NAMES[0].parse().unwrap(),
        ))
        .unwrap();
        assert_eq!(entity["pending"], self.pending_play);
        assert_eq!(entity["attempts"], self.attempts);
        assert_eq!(entity["shares"], self.shares);
        let rows = fx.game.get_log(Mode::Solo, 0, 0, 200);
        assert_eq!(rows.len() as u64, self.shares);
        assert!(rows.iter().all(|row| !row.verdict));
        assert_eq!(num(&fx.round()["pot"]), self.shares as u128 * 8_000);
        // A failed native receipt can have returned its principal before its callback.
        // It remains outside the ledger until that callback restores the owner's credit.
        assert_eq!(
            self.cash.balance,
            fx.money() + self.cash.surplus + self.returned_unresolved
        );
        assert_eq!(
            self.cash.inputs,
            self.cash.balance + self.cash.escrow + self.cash.paid + self.cash.compute_spent
        );
    }
}

#[test]
fn seeded_same_owner_withdrawal_overlaps_solo_plays() {
    let config = Config {
        failure_persistence: None,
        ..Config::default()
    };
    let mut runner = TestRunner::new_with_rng(
        config,
        TestRng::from_seed(RngAlgorithm::ChaCha, &[0xb7; 32]),
    );
    runner
        .run(
            &(
                0u8..3,
                any::<bool>(),
                any::<bool>(),
                any::<bool>(),
                1u64..500_001,
                0u8..3,
            ),
            |(outcome, withdraw_first, play_fails, below_boundary, topup, withheld_effect)| {
                let mut fx = fixture(params());
                let mut model = Overlap {
                    cash: Cash::default(),
                    credit: DEPOSIT - 100,
                    reserved: 0,
                    returned_unresolved: 0,
                    pending_play: false,
                    pending_withdrawal: false,
                    attempts: 0,
                    shares: 0,
                };
                model.cash.incoming(DEPOSIT);
                fx.ctx
                    .attached_deposit(NearToken::from_yoctonear(u128::from(topup)));
                reset(&fx);
                fx.game.deposit_credit();
                model.cash.incoming(u128::from(topup));
                model.credit += u128::from(topup);
                fx.at(10, 0);
                fx.commit();
                // Commit charges 100 stake and 100 storage; failed checking returns the stake.
                model.credit -= 200;
                fx.at(12, 0);
                let check = fx.reveal(0);
                fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                reset(&fx);
                assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
                fx.answer(check, PromiseResult::Failed);
                model.credit += 100;
                model.check(&fx);

                // Exactly one play remains affordable, or it is short by one yocto.
                let remaining = if below_boundary { 10_099 } else { 10_100 };
                let withdrawal = model.credit - remaining;
                fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                reset(&fx);
                fx.game.withdraw_credit(U128(withdrawal));
                model.cash.incoming(1);
                model.cash.surplus += 1;
                model.credit -= withdrawal;
                model.pending_withdrawal = true;
                let withdraw_id = callback_id("on_withdraw");
                let receipt = near_sdk::test_utils::get_created_receipts()
                    .into_iter()
                    .find(|r| {
                        r.actions
                            .iter()
                            .any(|a| matches!(a, MockAction::Transfer { .. }))
                    })
                    .unwrap();
                assert_eq!(receipt.receiver_id.as_str(), NAMES[0]);
                let sent = model.cash.outbound();
                assert_eq!(sent, withdrawal);
                model.reserved += sent;
                if outcome == 2 {
                    match withheld_effect {
                        0 => {}                                // Receipt is still in flight.
                        1 => model.cash.complete(sent, false), // Paid, callback withheld.
                        _ => {
                            model.cash.complete(sent, true); // Refunded, callback withheld.
                            model.returned_unresolved = sent;
                        }
                    }
                }
                model.check(&fx);

                fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
                reset(&fx);
                if below_boundary {
                    assert!(
                        panic_text(|| {
                            fx.game.play(Mode::Solo, 1, "otter".into());
                        })
                        .contains("E20")
                    );
                    model.check(&fx);
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                    reset(&fx);
                    fx.game.deposit_credit();
                    model.cash.incoming(1);
                    model.credit += 1;
                }
                fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
                reset(&fx);
                let play_id = fx.play(1, "otter");
                assert_eq!(model.cash.outbound(), 0);
                model.credit -= 10_100;
                model.pending_play = true;
                model.attempts += 1;
                model.check(&fx);
                fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                reset(&fx);
                assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
                deliver_env(&fx.ctx, PromiseResult::Failed);
                fx.game.on_withdraw(play_id);
                fx.game.on_verdict(withdraw_id);
                model.check(&fx);

                if withdraw_first && outcome != 2 {
                    model.cash.complete(sent, outcome == 1);
                    deliver_env(&fx.ctx, response(outcome == 1));
                    fx.game.on_withdraw(withdraw_id);
                    model.reserved -= sent;
                    model.pending_withdrawal = false;
                    if outcome == 1 {
                        model.credit += sent;
                    }
                    model.check(&fx);
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                    reset(&fx);
                    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
                }
                if play_fails {
                    deliver_env(&fx.ctx, PromiseResult::Failed);
                    fx.game.on_verdict(play_id);
                    model.credit += 10_100;
                    model.attempts -= 1;
                } else {
                    fx.verdict(play_id, 0);
                    model.shares += 1;
                }
                model.pending_play = false;
                model.check(&fx);
                if !withdraw_first && outcome != 2 {
                    model.cash.complete(sent, outcome == 1);
                    deliver_env(&fx.ctx, response(outcome == 1));
                    fx.game.on_withdraw(withdraw_id);
                    model.reserved -= sent;
                    model.pending_withdrawal = false;
                    if outcome == 1 {
                        model.credit += sent;
                    }
                    model.check(&fx);
                }

                // Fund a replacement play independently; no reserved principal is spendable.
                fx.ctx.attached_deposit(NearToken::from_yoctonear(10_100));
                reset(&fx);
                fx.game.deposit_credit();
                model.cash.incoming(10_100);
                model.credit += 10_100;
                let mut replacement_withdrawal = None;
                if outcome != 2 {
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                    reset(&fx);
                    fx.game.withdraw_credit(U128(1));
                    model.cash.incoming(1);
                    model.cash.surplus += 1;
                    model.credit -= 1;
                    replacement_withdrawal = Some(callback_id("on_withdraw"));
                    let replacement_sent = model.cash.outbound();
                    assert_eq!(replacement_sent, 1);
                    model.reserved += replacement_sent;
                    model.pending_withdrawal = true;
                    // Leave enough credit even when the previous play succeeded.
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                    reset(&fx);
                    fx.game.deposit_credit();
                    model.cash.incoming(1);
                    model.credit += 1;
                }
                fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
                reset(&fx);
                let replacement_play = fx.play(2, "otter");
                assert_eq!(model.cash.outbound(), 0);
                model.credit -= 10_100;
                model.attempts += 1;
                model.pending_play = true;
                deliver_env(&fx.ctx, response(false));
                if outcome != 2 {
                    fx.game.on_withdraw(withdraw_id);
                }
                fx.game.on_verdict(play_id);
                if let Some(id) = replacement_withdrawal {
                    fx.game.on_verdict(id);
                    fx.game.on_withdraw(replacement_play);
                }
                model.check(&fx);
                fx.verdict(replacement_play, 0);
                model.pending_play = false;
                model.shares += 1;
                model.check(&fx);
                fx.verdict(replacement_play, 0);
                model.check(&fx);
                if let Some(id) = replacement_withdrawal {
                    model.cash.complete(1, true);
                    deliver_env(&fx.ctx, response(true));
                    fx.game.on_withdraw(id);
                    model.reserved -= 1;
                    model.credit += 1;
                    model.pending_withdrawal = false;
                    model.check(&fx);
                } else {
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                    reset(&fx);
                    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
                    fx.at(50, OPEN_TIMEOUT * 2);
                    assert!(!fx.game.expire_request(withdraw_id));
                    model.check(&fx);
                }
                Ok(())
            },
        )
        .unwrap();
}

#[test]
fn withdrawal_and_later_guess_keep_independent_guards_and_principal() {
    for withdraw_first in [false, true] {
        for withdraw_failed in [false, true] {
            let mut fx = fixture(params());
            let mut cash = Cash::default();
            cash.incoming(DEPOSIT);
            fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
            reset(&fx);
            fx.game.withdraw_credit(U128(123));
            cash.incoming(1);
            cash.surplus += 1;
            let withdrawal = callback_id("on_withdraw");
            assert_eq!(cash.outbound(), 123);
            assert_eq!(fx.credit(), DEPOSIT - 100 - 123);

            // The payment is already reserved; a later guess uses only remaining credit.
            fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
            reset(&fx);
            fx.commit();
            assert_eq!(fx.credit(), DEPOSIT - 100 - 123 - 200);
            fx.at(2, 1);
            let guess = fx.reveal(0);
            cash.check(&fx);
            assert_eq!(fx.term("pending_native_payments"), 123);

            for step in 0..2 {
                if (step == 0) == withdraw_first {
                    cash.complete(123, withdraw_failed);
                    deliver_env(&fx.ctx, response(withdraw_failed));
                    fx.game.on_withdraw(withdrawal);
                    deliver_env(&fx.ctx, response(!withdraw_failed));
                    fx.game.on_withdraw(withdrawal);
                } else {
                    fx.answer(guess, PromiseResult::Failed);
                    fx.answer(guess, no());
                }
                cash.check(&fx);
                if step == 0 {
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                    reset(&fx);
                    let credit = fx.credit();
                    assert!(panic_text(|| fx.game.withdraw_credit(U128(1))).contains("E21"));
                    assert_eq!(fx.credit(), credit);
                    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
                }
            }
            assert_eq!(fx.term("pending_native_payments"), 0);
            assert_eq!(
                fx.credit(),
                DEPOSIT - 100 - 123 - 100 + if withdraw_failed { 123 } else { 0 }
            );
            fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
            reset(&fx);
            fx.game.withdraw_credit(U128(1));
            cash.incoming(1);
            cash.surplus += 1;
            assert_eq!(cash.outbound(), 1);
            assert_eq!(fx.term("pending_native_payments"), 1);
            cash.check(&fx);
        }
    }
}
