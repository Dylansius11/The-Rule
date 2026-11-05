mod common;

use common::*;
use game::Game;
use near_sdk::{NearToken, PromiseResult, json_types::U128, serde_json::json, testing_env};
use protocol::Mode;

const TIMEOUT: u64 = 600_000_000_000;
const PERIOD: u64 = 86_400_000_000_000;
const REGISTERED: &[u8] = br#"{"total":"1000","available":"0"}"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Callback {
    Begin,
    Verdict,
    Guess,
    Open,
    Withdraw,
    Platform,
    Register,
    Mint,
    Unlock,
}

const CALLBACKS: [Callback; 9] = [
    Callback::Begin,
    Callback::Verdict,
    Callback::Guess,
    Callback::Open,
    Callback::Withdraw,
    Callback::Platform,
    Callback::Register,
    Callback::Mint,
    Callback::Unlock,
];

fn dispatch(game: &mut Game, kind: Callback, id: u64) {
    match kind {
        Callback::Begin => game.on_begin(id),
        Callback::Verdict => game.on_verdict(id),
        Callback::Guess => game.on_guess(id),
        Callback::Open => game.on_open(id),
        Callback::Withdraw => game.on_withdraw(id),
        Callback::Platform => game.on_platform(id),
        Callback::Register => game.on_register(id),
        Callback::Mint => game.on_mint(id),
        Callback::Unlock => game.on_unlock(id),
    }
}

fn deliver(fx: &mut Fx, kind: Callback, id: u64, result: PromiseResult) {
    deliver_env(&fx.ctx, result);
    dispatch(&mut fx.game, kind, id);
}

fn request_from_receipt(method: &str) -> u64 {
    calls().into_iter().find(|c| c.1 == method).unwrap().2["request_id"]
        .as_u64()
        .unwrap()
}

fn registration(fx: &mut Fx) {
    let id = fx.game.register_token();
    deliver(
        fx,
        Callback::Register,
        id,
        PromiseResult::Successful(REGISTERED.to_vec()),
    );
}

fn lock(fx: &mut Fx, actor: &str, amount: u128) {
    fx.ctx
        .predecessor_account_id("token.testnet".parse().unwrap());
    testing_env!(fx.ctx.build());
    assert_eq!(
        fx.game
            .ft_on_transfer(
                actor.parse().unwrap(),
                U128(amount),
                json!({"lock":{"mode":0,"round_id":1}}).to_string()
            )
            .0,
        0
    );
    fx.ctx.predecessor_account_id(actor.parse().unwrap());
    testing_env!(fx.ctx.build());
}

fn locked(fx: &Fx, actor: &str) -> u128 {
    fx.game.get_lock(Mode::Solo, 1, actor.parse().unwrap()).0
}

// Mocked receipts reset the VM balance; this native matrix checks stored obligations.
// Real balance and transfer escrow are exercised by the sandbox balance reporter.
fn ledger(fx: &Fx) -> near_sdk::serde_json::Value {
    let mut value = fx.ledger();
    value.as_object_mut().unwrap().remove("balance");
    value
}

// Each wrong dispatcher gets a fresh request: a destructive first dispatcher cannot mask another.
#[test]
fn referee_requests_survive_every_wrong_callback() {
    for target in [Callback::Verdict, Callback::Guess] {
        for wrong in CALLBACKS.into_iter().filter(|c| *c != target) {
            for outcome in 0..3 {
                let mut fx = fixture(params());
                let before = ledger(&fx);
                let id = if target == Callback::Verdict {
                    fx.play(99, "otter")
                } else {
                    fx.commit();
                    fx.at(2, 1);
                    fx.reveal(0)
                };
                let pending = ledger(&fx);
                assert_eq!(pending["pending_referee_requests"], 1);
                let credit = fx.credit();
                deliver(&mut fx, wrong, id, PromiseResult::Failed);
                assert_eq!(ledger(&fx), pending, "{target:?} hit by {wrong:?}");
                if outcome == 1 {
                    fx.at(3, TIMEOUT + 1);
                    assert!(fx.game.expire_request(id));
                    assert!(!fx.game.expire_request(id));
                } else if outcome == 0 {
                    deliver(&mut fx, target, id, PromiseResult::Failed);
                } else if target == Callback::Verdict {
                    fx.verdict(id, 0);
                } else {
                    fx.answer(id, no());
                }
                assert_eq!(fx.ledger()["pending_referee_requests"], 0);
                let returned = match (target, outcome) {
                    (Callback::Verdict, 2) => 0,
                    (Callback::Verdict, _) => 10_100,
                    (Callback::Guess, 2) => 50,
                    _ => 100,
                };
                assert_eq!(fx.credit(), credit + returned);
                assert_eq!(
                    fx.money(),
                    num(&before["credit"]) + num(&before["storage_reserve"])
                );
                if target == Callback::Guess {
                    assert_eq!(
                        status(&fx.commits()[0]),
                        if outcome == 2 { "Wrong" } else { "Refunded" }
                    );
                    assert_eq!(fx.round()["pending_checks"], 0);
                }
                let settled = ledger(&fx);
                deliver(&mut fx, target, id, PromiseResult::Failed);
                assert_eq!(ledger(&fx), settled);
                let replacement = if target == Callback::Verdict {
                    fx.play(100, "otter")
                } else {
                    fx.commit();
                    let ctx = fx.ctx.build();
                    fx.at(ctx.block_index + 2, ctx.block_timestamp);
                    fx.reveal(1)
                };
                let replacement_pending = ledger(&fx);
                deliver(&mut fx, target, id, PromiseResult::Failed);
                assert_eq!(ledger(&fx), replacement_pending);
                assert_eq!(fx.ledger()["pending_referee_requests"], 1);
                deliver(&mut fx, target, replacement, PromiseResult::Failed);
                assert_eq!(fx.ledger()["pending_referee_requests"], 0);
                fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                testing_env!(fx.ctx.build());
                fx.game.withdraw_credit(U128(1)); // player/guess guards are released
            }
        }
    }
}

#[test]
fn non_referee_requests_survive_every_wrong_callback() {
    for target in [
        Callback::Withdraw,
        Callback::Platform,
        Callback::Register,
        Callback::Mint,
        Callback::Unlock,
    ] {
        for wrong in CALLBACKS.into_iter().filter(|c| *c != target) {
            for failed in [false, true] {
                let mut fx = fixture(params());
                if target == Callback::Mint {
                    registration(&mut fx);
                }
                if target == Callback::Platform {
                    let play = fx.play(1, "otter");
                    fx.verdict(play, 0);
                }
                if target == Callback::Unlock {
                    lock(&mut fx, "bob.near", 123);
                    fx.actor("second.near");
                    lock(&mut fx, "second.near", 234);
                    fx.actor("bob.near");
                }
                // Keep a real referee request live throughout the non-referee callbacks.
                fx.actor("watcher.near");
                let watcher = fx.play(999, "otter");
                fx.actor("bob.near");
                let before_credit = fx.credit();
                let before_platform = fx.term("platform_accrued");
                let id = match target {
                    Callback::Withdraw => {
                        fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                        testing_env!(fx.ctx.build());
                        fx.game.withdraw_credit(U128(123));
                        request_from_receipt("on_withdraw")
                    }
                    Callback::Platform => fx.game.claim_platform(),
                    Callback::Register => fx.game.register_token(),
                    Callback::Mint => {
                        let play = fx.play(2, "otter");
                        fx.verdict(play, 1);
                        request_from_receipt("on_mint")
                    }
                    Callback::Unlock => {
                        fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                        fx.at(50, 2 * PERIOD);
                        fx.game.unlock(Mode::Solo, 1);
                        request_from_receipt("on_unlock")
                    }
                    _ => unreachable!(),
                };
                let pending = ledger(&fx);
                assert_eq!(pending["pending_referee_requests"], 1);
                if target == Callback::Register {
                    assert!(
                        panic_text(|| {
                            fx.game.expire_request(id);
                        })
                        .contains("E50")
                    );
                } else {
                    assert!(!fx.game.expire_request(id));
                }
                deliver(&mut fx, wrong, id, PromiseResult::Failed);
                assert_eq!(ledger(&fx), pending, "{target:?} hit by {wrong:?}");
                let response = if failed {
                    PromiseResult::Failed
                } else if target == Callback::Register {
                    PromiseResult::Successful(REGISTERED.to_vec())
                } else {
                    PromiseResult::Successful(Vec::new())
                };
                deliver(&mut fx, target, id, response);
                assert_eq!(fx.ledger()["pending_referee_requests"], 1);
                match target {
                    Callback::Withdraw => {
                        assert_eq!(fx.credit(), before_credit - if failed { 0 } else { 123 })
                    }
                    Callback::Platform => assert_eq!(
                        fx.term("platform_accrued"),
                        if failed { before_platform } else { 0 }
                    ),
                    Callback::Register => assert_eq!(
                        fx.game.get_token_state("bob.near".parse().unwrap()),
                        if failed { "none" } else { "registered" }
                    ),
                    Callback::Mint => {
                        assert_eq!(
                            fx.round()["allowance_left"],
                            if failed { "500000" } else { "499900" }
                        );
                        let row = near_sdk::serde_json::to_value(
                            &fx.game.get_log(Mode::Solo, 0, 0, 1)[0],
                        )
                        .unwrap();
                        assert_eq!(row["minted"], if failed { "0" } else { "100" });
                    }
                    Callback::Unlock => {
                        assert_eq!(locked(&fx, "bob.near"), if failed { 123 } else { 0 })
                    }
                    _ => unreachable!(),
                }
                // A different live request must be unaffected by the old callback, including a
                // same-kind replacement where the public API permits it.
                let replacement = match target {
                    Callback::Withdraw => {
                        testing_env!(fx.ctx.build());
                        fx.game.withdraw_credit(U128(1));
                        request_from_receipt("on_withdraw")
                    }
                    Callback::Register => fx.game.register_token(),
                    Callback::Unlock => {
                        fx.actor("second.near");
                        fx.ctx.attached_deposit(NearToken::from_yoctonear(1));
                        testing_env!(fx.ctx.build());
                        fx.game.unlock(Mode::Solo, 1);
                        request_from_receipt("on_unlock")
                    }
                    Callback::Platform if failed => fx.game.claim_platform(),
                    Callback::Mint => {
                        let play = fx.play(3, "otter");
                        fx.verdict(play, 1);
                        request_from_receipt("on_mint")
                    }
                    _ => fx.game.register_token(),
                };
                let state = ledger(&fx);
                let round = fx.round();
                deliver(&mut fx, target, id, PromiseResult::Failed);
                assert_eq!(ledger(&fx), state);
                assert_eq!(fx.round(), round);
                let replacement_kind = if target == Callback::Platform && !failed {
                    Callback::Register
                } else {
                    target
                };
                deliver(
                    &mut fx,
                    replacement_kind,
                    replacement,
                    PromiseResult::Failed,
                );
                assert_eq!(fx.ledger()["pending_referee_requests"], 1);
                match replacement_kind {
                    Callback::Withdraw => {
                        assert_eq!(fx.credit(), before_credit - if failed { 0 } else { 123 })
                    }
                    Callback::Platform => assert_eq!(fx.term("platform_accrued"), before_platform),
                    Callback::Mint => assert_eq!(
                        fx.round()["allowance_left"],
                        if failed { "500000" } else { "499900" }
                    ),
                    Callback::Unlock => assert_eq!(locked(&fx, "second.near"), 234),
                    _ => {}
                }
                if replacement_kind == Callback::Register {
                    assert_eq!(fx.game.get_token_state("bob.near".parse().unwrap()), "none");
                }
                deliver(&mut fx, Callback::Verdict, watcher, PromiseResult::Failed);
                assert_eq!(fx.ledger()["pending_referee_requests"], 0);
            }
        }
    }
}
