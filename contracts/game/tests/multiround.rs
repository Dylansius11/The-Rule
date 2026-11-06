//! Generated Solo cross-round principal and per-owner payout checks in the native VM.
//! Receipt principal is modeled from attached deposits and created actions; the VM does not
//! execute those actions or model storage collateral. This is not a chain-balance proof.
mod common;

use common::*;
use near_sdk::serde_json::{Value, json};
use near_sdk::{NearToken, PromiseResult, mock::MockAction, testing_env};
use proptest::{
    prelude::*,
    test_runner::{Config, RngAlgorithm, TestRng, TestRunner},
};
use protocol::Mode;

const PLAYERS: [&str; 3] = ["bob.near", "carol.near", "dave.near"];
const PERIOD: u64 = 86_400_000_000_000;

fn round(fx: &Fx, id: u32) -> Value {
    near_sdk::serde_json::to_value(fx.game.get_round(Mode::Solo, Some(id)).unwrap()).unwrap()
}
fn claimable(fx: &Fx, id: u32, owner: &str) -> u128 {
    num(&near_sdk::serde_json::to_value(fx.game.get_claimable(
        Mode::Solo,
        id,
        owner.parse().unwrap(),
    ))
    .unwrap())
}
fn check_principal(fx: &Fx, inputs: u128, spent: u128) {
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
    assert_eq!(tracked + spent, inputs);
}
fn receipt_spend() -> u128 {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .map(|a| match a {
            MockAction::FunctionCallWeight {
                attached_deposit, ..
            } => attached_deposit.as_yoctonear(),
            MockAction::Transfer { deposit, .. } => deposit.as_yoctonear(),
            _ => 0,
        })
        .sum()
}
fn begin(fx: &mut Fx, request: u64) {
    let answer = json!({"commit":protocol::round_commitment(&fx.rule, &ROUND_SALT),"header":{"tier":"daily","bucket":"rare","grammar":"22".repeat(32)}});
    deliver_env(
        &fx.ctx,
        PromiseResult::Successful(answer.to_string().into_bytes()),
    );
    fx.game.on_begin(request);
}
fn run_case(seed: u128, ops: &[(usize, bool)], retry_begin: bool, retry_open: bool) {
    let mut p = params();
    p.open_timeout_ns = 2 * PERIOD;
    p.outlayer_deposit.verdict.0 = 3;
    p.outlayer_deposit.open.0 = 5;
    // The fixture starts round zero, so fund compute before it does so.
    let mut fx = fixture_with(p, seed, "rare", |game, ctx| {
        ctx.attached_deposit(NearToken::from_yoctonear(1_000));
        testing_env!(ctx.build());
        game.fund_compute();
    });
    let mut inputs = DEPOSIT + seed + 1_000;
    let mut spent = 0; // fixture's begin has no attached principal
    for name in &PLAYERS[1..] {
        fx.actor(name);
        inputs += DEPOSIT;
    }
    let mut credits = [DEPOSIT - 100; 3];
    let mut shares = [[0u128; 3]; 2];
    let mut pots = [seed, 0];
    let mut opens = [0u64; 2];
    for id in 0..2usize {
        if id == 1 {
            fx.at(100, PERIOD);
            testing_env!(fx.ctx.build());
            let first = fx.game.start_round(Mode::Solo);
            spent += receipt_spend();
            if retry_begin {
                deliver_env(&fx.ctx, PromiseResult::Failed);
                fx.game.on_begin(first);
                testing_env!(fx.ctx.build());
                let second = fx.game.start_round(Mode::Solo);
                spent += receipt_spend();
                begin(&mut fx, second);
                begin(&mut fx, first); // stale result must not replace the new round
            } else {
                begin(&mut fx, first);
            }
            // Opening round zero remains unresolved while round one is live.
            assert_eq!(round(&fx, 0)["phase"], "Opening");
            assert_eq!(num(&round(&fx, 1)["pot"]), 0);
        }
        for (i, &(owner, success)) in ops.iter().enumerate() {
            fx.actor(PLAYERS[owner]);
            testing_env!(fx.ctx.build());
            let request = fx.play((id * 100 + i + 1) as u16, "otter");
            spent += receipt_spend();
            if success {
                fx.verdict(request, 0);
                credits[owner] -= 10_100;
                shares[id][owner] += 1;
                pots[id] += 8_000;
            } else {
                deliver_env(&fx.ctx, PromiseResult::Failed);
                fx.game.on_verdict(request);
            }
            fx.verdict(request, 1);
            check_principal(&fx, inputs, spent);
            for (index, name) in PLAYERS.iter().enumerate() {
                assert_eq!(credit_of(&fx.game, name), credits[index]);
            }
        }
        // A pending play crossing the phase transition is refunded, even on YES.
        fx.actor(PLAYERS[0]);
        testing_env!(fx.ctx.build());
        let late = fx.play((700 + id) as u16, "otter");
        spent += receipt_spend();
        let end = round(&fx, id as u32)["investigation_end_ns"]
            .as_u64()
            .unwrap();
        fx.at(200 + id as u64, end);
        fx.game.advance(Mode::Solo);
        if retry_begin {
            assert!(fx.game.expire_request(late));
            assert!(!fx.game.expire_request(late));
        }
        fx.verdict(late, 1);
        fx.verdict(late, 0);
        let deadline = round(&fx, id as u32)["reveal_deadline_ns"]
            .as_u64()
            .unwrap();
        fx.at(210 + id as u64, deadline);
        testing_env!(fx.ctx.build());
        opens[id] = fx.game.finalize(Mode::Solo).unwrap();
        spent += receipt_spend();
        check_principal(&fx, inputs, spent);
    }
    let mut expected_carry = 0;
    for id in 0..2usize {
        if retry_open && id == 0 {
            fx.on_open(opens[id], PromiseResult::Failed);
            testing_env!(fx.ctx.build());
            let replacement = fx.game.retry_open(Mode::Solo, id as u32);
            spent += receipt_spend();
            let result = fx.open_ok();
            fx.on_open(replacement, result);
        } else {
            let result = fx.open_ok();
            fx.on_open(opens[id], result);
        }
        fx.on_open(opens[id], PromiseResult::Failed);
        let total: u128 = shares[id].iter().sum();
        let per_share = (pots[id] * 4_000 / 10_000).checked_div(total).unwrap_or(0);
        let platform = pots[id] / 10;
        let paid = per_share * total;
        expected_carry += pots[id] - platform - paid;
        for (owner, name) in PLAYERS.iter().enumerate() {
            let expected = shares[id][owner] * per_share;
            assert_eq!(claimable(&fx, id as u32, name), expected);
            if expected > 0 {
                fx.actor(name);
                fx.game.claim(Mode::Solo, id as u32);
                credits[owner] += expected;
                assert_eq!(credit_of(&fx.game, name), credits[owner]);
                assert_eq!(claimable(&fx, id as u32, name), 0);
            }
        }
        assert_eq!(fx.term("carry"), expected_carry);
        check_principal(&fx, inputs, spent);
    }
    assert_eq!(fx.term("round_pots"), 0);
    assert_eq!(fx.term("claimable"), 0);
}

#[test]
fn seeded_cross_round_owner_and_cash_invariants() {
    let config = Config {
        failure_persistence: None,
        ..Config::default()
    };
    let mut runner = TestRunner::new_with_rng(
        config,
        TestRng::from_seed(RngAlgorithm::ChaCha, &[0x87; 32]),
    );
    runner
        .run(
            &(
                1u128..10_000,
                prop::collection::vec((0usize..3, any::<bool>()), 1..7),
                any::<bool>(),
                any::<bool>(),
            ),
            |(seed, ops, begin_retry, open_retry)| {
                run_case(seed, &ops, begin_retry, open_retry);
                Ok(())
            },
        )
        .unwrap();
}

/// This models only observed mint actions and delivered outcomes in the native VM.
/// The separate sandbox executable checks actual token supply and balances.
#[test]
fn seeded_mint_receipts_match_log_and_allowance() {
    let config = Config {
        failure_persistence: None,
        ..Config::default()
    };
    let mut runner = TestRunner::new_with_rng(
        config,
        TestRng::from_seed(RngAlgorithm::ChaCha, &[0x93; 32]),
    );
    runner
        .run(
            &prop::collection::vec((0usize..3, any::<bool>()), 1..12),
            |ops| {
                let mut fx = fixture(params());
                for name in PLAYERS {
                    fx.actor(name);
                    testing_env!(fx.ctx.build());
                    let request = fx.game.register_token();
                    deliver_env(
                        &fx.ctx,
                        PromiseResult::Successful(br#"{"total":"1000","available":"0"}"#.to_vec()),
                    );
                    fx.game.on_register(request);
                }
                let mut allowance = 500_000u128;
                let mut successful = [0u128; 3];
                for (i, (owner, success)) in ops.into_iter().enumerate() {
                    fx.actor(PLAYERS[owner]);
                    testing_env!(fx.ctx.build());
                    let verdict = fx.play(i as u16 + 1, "otter");
                    fx.verdict(verdict, 1);
                    let created = calls();
                    let mint = created
                        .iter()
                        .find(|(_, method, _, _)| method == "mint")
                        .unwrap();
                    let amount = 100 * allowance / 500_000;
                    assert_eq!(mint.2["account_id"], PLAYERS[owner]);
                    assert_eq!(num(&mint.2["amount"]), amount);
                    let callback = created
                        .iter()
                        .find(|(_, method, _, _)| method == "on_mint")
                        .unwrap()
                        .2["request_id"]
                        .as_u64()
                        .unwrap();
                    deliver_env(
                        &fx.ctx,
                        if success {
                            PromiseResult::Successful(Vec::new())
                        } else {
                            PromiseResult::Failed
                        },
                    );
                    fx.game.on_mint(callback);
                    if success {
                        allowance -= amount;
                        successful[owner] += amount;
                    }
                    deliver_env(&fx.ctx, PromiseResult::Failed);
                    fx.game.on_mint(callback);
                    assert_eq!(num(&fx.round()["allowance_left"]), allowance);
                    let rows = fx.game.get_log(Mode::Solo, 0, 0, 200);
                    let logged: u128 = rows
                        .iter()
                        .map(|row| num(&near_sdk::serde_json::to_value(row).unwrap()["minted"]))
                        .sum();
                    assert_eq!(logged, successful.iter().sum::<u128>());
                    assert_eq!(logged + allowance, 500_000);
                }
                Ok(())
            },
        )
        .unwrap();
}

/// Five independently funded members participate as one entity. The oracle starts from
/// deposits and fee inputs, then applies exact per-owner pro-rata withdrawals and equal
/// snapshot payouts even after the roster has been dismantled.
#[test]
fn seeded_team_roster_vault_and_terminal_rights() {
    const MEMBERS: [&str; 5] = [
        "bob.near",
        "carol.near",
        "dave.near",
        "erin.near",
        "frank.near",
    ];
    let config = Config {
        failure_persistence: None,
        ..Config::default()
    };
    let mut runner = TestRunner::new_with_rng(
        config,
        TestRng::from_seed(RngAlgorithm::ChaCha, &[0x62; 32]),
    );
    let strategy = (
        prop::array::uniform5(20_000u128..30_000),
        1usize..4,
        any::<bool>(),
        0usize..4,
        any::<u8>(),
        1u128..10_000,
    );
    runner
        .run(
            &strategy,
            |(weights, plays, void, rotation, withdraw_mask, seed)| {
                let mut fx = fixture(params());
                for name in &MEMBERS[1..] {
                    fx.actor(name);
                }
                fx.actor(MEMBERS[0]);
                fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
                testing_env!(fx.ctx.build());
                let id = fx.game.create_team("alpha".into());
                for name in &MEMBERS[1..] {
                    fx.actor(MEMBERS[0]);
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
                    testing_env!(fx.ctx.build());
                    fx.game.invite(name.parse().unwrap());
                    fx.actor(name);
                    testing_env!(fx.ctx.build());
                    fx.game.join_team(id);
                }
                let members = fx.game.get_team(id).unwrap()["members"]
                    .as_array()
                    .unwrap()
                    .clone();
                assert_eq!(members.len(), 5);
                fx.actor(MEMBERS[0]);
                testing_env!(fx.ctx.build());
                assert!(
                    panic_text(|| fx.game.invite("extra.near".parse().unwrap())).contains("E31")
                );
                let mut vault: u128 = weights.iter().sum();
                let mut weight = vault;
                let mut credits = [DEPOSIT - 100; 5];
                credits[0] -= 100; // team storage
                for (i, name) in MEMBERS.iter().enumerate() {
                    fx.actor(name);
                    fx.ctx
                        .attached_deposit(NearToken::from_yoctonear(weights[i]));
                    testing_env!(fx.ctx.build());
                    fx.game.team_deposit(id);
                }
                fx.ctx.attached_deposit(NearToken::from_yoctonear(seed));
                testing_env!(fx.ctx.build());
                fx.game.seed_pot(Mode::Team);
                fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
                testing_env!(fx.ctx.build());
                let request = fx.game.start_round(Mode::Team);
                begin(&mut fx, request);
                for i in 0..plays {
                    fx.actor(MEMBERS[i % 5]);
                    testing_env!(fx.ctx.build());
                    let request = match fx.game.play(Mode::Team, (100 + i) as u16, "otter".into()) {
                        game::PlayAck::Pending { request_id, .. } => request_id,
                        _ => panic!("unique play unexpectedly known"),
                    };
                    fx.verdict(request, 0);
                    vault -= 10_100;
                    assert_eq!(num(&fx.game.get_team(id).unwrap()["vault"]), vault);
                }
                fx.actor(MEMBERS[1]);
                testing_env!(fx.ctx.build());
                assert!(panic_text(|| fx.game.leave_team()).contains("E30"));
                fx.at(10, INVESTIGATION_END);
                fx.game.advance(Mode::Team);
                let round =
                    near_sdk::serde_json::to_value(fx.game.get_round(Mode::Team, Some(0)).unwrap())
                        .unwrap();
                let pot = seed + 8_000 * plays as u128;
                assert_eq!(num(&round["pot"]), pot);
                fx.at(11, round["reveal_deadline_ns"].as_u64().unwrap());
                testing_env!(fx.ctx.build());
                let open = fx.game.finalize(Mode::Team).unwrap();
                let response = if void {
                    fx.open_with([4; 32])
                } else {
                    fx.open_ok()
                };
                fx.on_open(open, response);
                let refund = if void { 8_000 * plays as u128 } else { 0 };
                assert_eq!(fx.game.settle_team(id).0, refund);
                vault += refund;
                let payout = if void {
                    0
                } else {
                    ((pot * 4_000 / 10_000) / plays as u128) * plays as u128 / 5
                };
                for (i, name) in MEMBERS.iter().enumerate() {
                    let owed = fx
                        .game
                        .get_claimable(Mode::Team, 0, name.parse().unwrap())
                        .0;
                    assert_eq!(owed, payout, "snapshot member {i}");
                }
                // Rotate non-captain departures, exercising both explicit withdrawal and
                // automatic withdrawal on leaving. Captain leaves last and destroys the roster.
                for step in 0..5 {
                    let i = if step == 4 {
                        0
                    } else {
                        1 + (step + rotation) % 4
                    };
                    let amount = vault * weights[i] / weight;
                    fx.actor(MEMBERS[i]);
                    if withdraw_mask & (1 << i) != 0 {
                        fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                        testing_env!(fx.ctx.build());
                        assert_eq!(fx.game.team_withdraw(id).0, amount);
                    }
                    fx.ctx.attached_deposit(NearToken::from_yoctonear(0));
                    testing_env!(fx.ctx.build());
                    fx.game.leave_team();
                    vault -= amount;
                    weight -= weights[i];
                    credits[i] += amount;
                    assert_eq!(credit_of(&fx.game, MEMBERS[i]), credits[i]);
                }
                assert_eq!(vault, 0);
                assert!(fx.game.get_team(id).is_none());
                if payout > 0 {
                    for (i, name) in MEMBERS.iter().enumerate() {
                        fx.actor(name);
                        testing_env!(fx.ctx.build());
                        assert_eq!(fx.game.claim_team(Mode::Team, 0, id).0, payout);
                        credits[i] += payout;
                        assert_eq!(credit_of(&fx.game, name), credits[i]);
                    }
                }
                assert_eq!(fx.term("vault"), 0);
                assert_eq!(fx.term("claimable"), 0);
                // The one-yocto authorization inputs are surplus, not ledger obligations.
                // All referee deposits are zero and this sequence creates no payment action.
                check_principal(&fx, 5 * DEPOSIT + weights.iter().sum::<u128>() + seed, 0);
                Ok(())
            },
        )
        .unwrap();
}
