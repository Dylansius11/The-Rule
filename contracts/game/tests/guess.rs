use game::Game;
use near_sdk::serde_json::{Value, json};
use near_sdk::{
    NearToken, PromiseResult, RuntimeFeesConfig, test_utils::VMContextBuilder, testing_env,
};
use proptest::prelude::*;
use protocol::{CommitPreimage, Entity, Hex32, Mode, Params, RuleHex};
use rule_core::CanonicalRule;

const SALT: [u8; 32] = [7; 32];
const BEGIN: &str = r#"{"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}}"#;
/// Message of the panic raised by `f`; empty string when it does not panic.
fn panic_text(f: impl FnOnce()) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(()) => String::new(),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| (*s).to_owned()))
            .unwrap_or_default(),
    }
}

fn params() -> Params {
    let limits = json!({"instructions":1000000000,"memory_mb":128,"execution_seconds":5});
    near_sdk::serde_json::from_value(json!({
        "play_fee":"10000","fee_split_bps":[8000,1500,500],"storage_charge_per_play":"100","storage_charge_account":"100","storage_charge_team":"100",
        "stake_bps":[100,200],"stake_min":"100","wrong_return_bps":5000,"solved_split_bps":[4000,4000,1000,1000],"unsolved_split_bps":[4000,5000,1000],
        "genesis_ns":0,"round_period_ns":86400000000000u64,"mode_offset_ns":[0,0],"investigation_max_ns":3600000000000u64,"reveal_window_ns":60000000000u64,"begin_timeout_ns":3600000000000u64,"open_timeout_ns":3600000000000u64,
        "min_reveal_delay_blocks":2,"base_attempts":[25,50],"lock_tiers":[],"attempt_cap":[125,250],"share_cap":[25,50],"round_allowance":"500000","mint_base":"100","max_team_size":5,
        "referee":{"outlayer":"outlayer.testnet","urls":["https://example.com/referee.wasm"],"hash":"0000000000000000000000000000000000000000000000000000000000000000","build_target":"wasm32-wasip2"},
        "resource_limits":{"begin":limits,"verdict":limits,"guess":limits,"open":limits},"outlayer_deposit":{"begin":"0","verdict":"0","guess":"0","open":"0"},"gas_outlayer":100000000000000u64,"gas_callback":30000000000000u64,"gas_mint":10000000000000u64,"token":"token.testnet","platform":"platform.testnet","chain_id":"testnet"
    })).unwrap()
}

struct Fx {
    ctx: VMContextBuilder,
    game: Game,
    rule: CanonicalRule,
}

fn deliver_env(ctx: &VMContextBuilder, result: PromiseResult) {
    testing_env!(
        ctx.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn fixture(p: Params) -> Fx {
    // The mocked blockchain keeps its storage across `testing_env!`: start every fixture empty.
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut ctx = VMContextBuilder::new();
    ctx.prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(1_000_000));
    testing_env!(ctx.build());
    let mut game = Game::new(p, true);
    game.deposit_credit();
    let request = game.start_round(Mode::Solo);
    deliver_env(&ctx, PromiseResult::Successful(BEGIN.as_bytes().to_vec()));
    game.on_begin(request);
    let (rule, _) = rule_core::sample(b"guess-tests");
    Fx { ctx, game, rule }
}

impl Fx {
    fn at(&mut self, block: u64, ns: u64) {
        self.ctx.block_height(block).block_timestamp(ns);
        testing_env!(self.ctx.build());
    }

    fn hash_for(&self, salt: &[u8; 32]) -> Hex32 {
        let c = self.ctx.build();
        protocol::commit_hash(&CommitPreimage {
            chain: "testnet",
            game: c.current_account_id.as_str(),
            mode: Mode::Solo,
            round: 0,
            actor: c.predecessor_account_id.as_str(),
            entity: Entity::Solo(0),
            guess: &self.rule,
            salt,
        })
    }

    fn commit(&mut self) -> Value {
        let hash = self.hash_for(&SALT);
        near_sdk::serde_json::to_value(self.game.commit_guess(Mode::Solo, hash)).unwrap()
    }

    fn rule_hex(&self) -> String {
        near_sdk::serde_json::to_value(RuleHex(self.rule.clone()))
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned()
    }

    fn reveal(&mut self, commit_seq: u32) -> u64 {
        let hex = self.rule_hex();
        self.game
            .reveal_guess(Mode::Solo, commit_seq, hex, Hex32(SALT))
    }

    fn answer(&mut self, request: u64, result: PromiseResult) {
        deliver_env(&self.ctx, result);
        self.game.on_guess(request);
    }

    fn round(&self) -> Value {
        near_sdk::serde_json::to_value(self.game.get_round(Mode::Solo, None).unwrap()).unwrap()
    }

    fn commits(&self) -> Vec<Value> {
        self.game
            .get_commits(Mode::Solo, 0, 0, 200)
            .into_iter()
            .map(|c| near_sdk::serde_json::to_value(c).unwrap())
            .collect()
    }

    fn ledger(&self) -> Value {
        near_sdk::serde_json::to_value(self.game.get_ledger()).unwrap()
    }

    fn credit(&self) -> u128 {
        let c = self.ctx.build().predecessor_account_id;
        num(&self.game.get_player(c).unwrap()["credit"])
    }

    /// Every yocto the contract tracks outside its own balance: stays constant across guesses.
    fn money(&self) -> u128 {
        let l = self.ledger();
        [
            "credit",
            "round_pots",
            "open_stakes",
            "storage_reserve",
            "platform_accrued",
            "compute_float",
            "pending_credit",
        ]
        .iter()
        .map(|k| num(&l[*k]))
        .sum()
    }
}

fn num(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

fn yes() -> PromiseResult {
    PromiseResult::Successful(br#"{"correct":true}"#.to_vec())
}
fn no() -> PromiseResult {
    PromiseResult::Successful(br#"{"correct":false}"#.to_vec())
}

fn status(c: &Value) -> &str {
    c["status"].as_str().unwrap()
}

#[test]
fn commit_locks_floor_stake_and_storage_charge() {
    let mut fx = fixture(params());
    let (credit, money) = (fx.credit(), fx.money());
    let ack = fx.commit();
    assert_eq!(ack["commit_seq"], 0);
    assert_eq!(num(&ack["stake"]), 100);
    assert_eq!(credit - fx.credit(), 100 + 100);
    assert_eq!(num(&fx.ledger()["open_stakes"]), 100);
    assert_eq!(fx.money(), money);
    let commits = fx.commits();
    assert_eq!(status(&commits[0]), "Committed");
    assert_eq!(commits[0]["seq"], ack["seq"]);
}

#[test]
fn stake_is_percentage_of_pot_above_the_floor() {
    let mut p = params();
    p.stake_min.0 = 1;
    let mut fx = fixture(p);
    let request = match fx.game.play(Mode::Solo, 2, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    deliver_env(&fx.ctx, PromiseResult::Successful(br#"{"v":1}"#.to_vec()));
    fx.game.on_verdict(request);
    let pot = num(&fx.round()["pot"]);
    assert_eq!(pot, 8_000);
    let ack = fx.commit();
    assert_eq!(num(&ack["stake"]), pot / 100);
}

#[test]
#[should_panic(expected = "E10")]
fn commit_requires_investigation() {
    let mut ctx = VMContextBuilder::new();
    ctx.attached_deposit(NearToken::from_yoctonear(1_000_000));
    testing_env!(ctx.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    game.start_round(Mode::Solo);
    game.commit_guess(Mode::Solo, Hex32([1; 32]));
}

#[test]
#[should_panic(expected = "E32")]
fn team_commit_is_rejected_until_teams_exist() {
    let mut fx = fixture(params());
    fx.game.commit_guess(Mode::Team, Hex32([1; 32]));
}

#[test]
#[should_panic(expected = "E20")]
fn commit_needs_credit_for_stake_and_storage() {
    let mut fx = fixture(params());
    fx.ctx
        .predecessor_account_id("carol.near".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(250));
    testing_env!(fx.ctx.build());
    fx.game.deposit_credit();
    // 150 credit after the 100 account charge: below stake 100 + storage 100.
    fx.game.commit_guess(Mode::Solo, Hex32([1; 32]));
}

#[test]
#[should_panic(expected = "E15")]
fn fourth_open_commit_is_rejected() {
    let mut fx = fixture(params());
    for _ in 0..4 {
        fx.commit();
    }
}

/// Fixture with one commit made at block 10 and the clock at block 12.
fn committed(p: Params) -> Fx {
    let mut fx = fixture(p);
    fx.at(10, 0);
    fx.commit();
    fx.at(12, 0);
    fx
}

#[test]
#[should_panic(expected = "E19")]
fn reveal_with_wrong_salt_is_rejected() {
    let mut fx = committed(params());
    let hex = fx.rule_hex();
    fx.game.reveal_guess(Mode::Solo, 0, hex, Hex32([8; 32]));
}

#[test]
#[should_panic(expected = "E19")]
fn reveal_of_a_different_rule_is_rejected() {
    let mut fx = committed(params());
    let (other, _) = rule_core::sample(b"another rule");
    assert_ne!(other, fx.rule);
    fx.rule = other;
    fx.reveal(0);
}

#[test]
#[should_panic(expected = "E17")]
fn reveal_by_another_account_is_rejected() {
    let mut fx = committed(params());
    fx.ctx.predecessor_account_id("carol.near".parse().unwrap());
    testing_env!(fx.ctx.build());
    fx.reveal(0);
}

#[test]
#[should_panic(expected = "E18")]
fn reveal_in_the_commit_block_range_is_rejected() {
    let mut fx = committed(params());
    fx.at(11, 0);
    fx.reveal(0);
}

#[test]
fn reveal_is_allowed_exactly_at_the_minimum_delay() {
    let mut fx = committed(params());
    fx.reveal(0);
    assert_eq!(status(&fx.commits()[0]), "Checking");
}

#[test]
#[should_panic(expected = "E22")]
fn reveal_requires_funded_compute() {
    let mut p = params();
    p.outlayer_deposit.guess.0 = 5;
    let mut fx = committed(p);
    fx.reveal(0);
}

#[test]
#[should_panic(expected = "E11")]
fn reveal_of_a_malformed_rule_is_rejected() {
    let mut fx = committed(params());
    fx.game
        .reveal_guess(Mode::Solo, 0, "zz".into(), Hex32(SALT));
}

#[test]
#[should_panic(expected = "E11")]
fn reveal_of_an_unknown_commit_is_rejected() {
    let mut fx = committed(params());
    fx.reveal(5);
}

#[test]
#[should_panic(expected = "E10")]
fn a_commit_cannot_be_revealed_twice() {
    let mut fx = committed(params());
    fx.reveal(0);
    fx.reveal(0);
}

#[test]
fn correct_guess_freezes_the_round_and_blocks_plays_and_commits() {
    let mut fx = fixture(params());
    fx.at(10, 5_000);
    fx.commit();
    fx.at(12, 5_000);
    let request = fx.reveal(0);
    assert_eq!(status(&fx.commits()[0]), "Checking");
    assert_eq!(fx.round()["pending_checks"], 1);
    fx.at(12, 9_000);
    fx.answer(request, yes());
    assert_eq!(status(&fx.commits()[0]), "Correct");
    let round = fx.round();
    assert_eq!(round["phase"], "Reveal");
    assert_eq!(round["pending_checks"], 0);
    assert_eq!(round["freeze_ns"], 9_000);
    assert_eq!(round["reveal_deadline_ns"], 9_000 + 60_000_000_000u64);
    // The stake stays locked: it is neither refunded nor moved to the pot yet.
    assert_eq!(num(&fx.ledger()["open_stakes"]), 100);
}

#[test]
#[should_panic(expected = "E10")]
fn play_after_freeze_is_rejected() {
    let mut fx = fixture(params());
    fx.at(10, 0);
    fx.commit();
    fx.at(12, 0);
    let request = fx.reveal(0);
    fx.answer(request, yes());
    fx.game.play(Mode::Solo, 1, "otter".into());
}

#[test]
#[should_panic(expected = "E10")]
fn commit_after_freeze_is_rejected() {
    let mut fx = fixture(params());
    fx.at(10, 0);
    fx.commit();
    fx.at(12, 0);
    let request = fx.reveal(0);
    fx.answer(request, yes());
    fx.commit();
}

#[test]
fn in_flight_play_refunds_when_a_guess_freezes_the_round() {
    let mut fx = fixture(params());
    fx.at(10, 0);
    fx.commit();
    let play = match fx.game.play(Mode::Solo, 2, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    fx.at(12, 0);
    let money = fx.money();
    let guess = fx.reveal(0);
    fx.answer(guess, yes());
    deliver_env(&fx.ctx, PromiseResult::Successful(br#"{"v":1}"#.to_vec()));
    fx.game.on_verdict(play);
    assert!(fx.game.get_log(Mode::Solo, 0, 0, 200).is_empty());
    assert_eq!(fx.money(), money);
    assert_eq!(num(&fx.round()["pot"]), 0);
}

#[test]
#[should_panic(expected = "E16")]
fn reveal_after_the_deadline_is_rejected() {
    let mut fx = fixture(params());
    fx.at(10, 0);
    fx.commit();
    fx.commit();
    fx.at(12, 1_000);
    let request = fx.reveal(0);
    fx.answer(request, yes());
    fx.at(14, 1_000 + 60_000_000_000);
    fx.reveal(1);
}

#[test]
fn second_correct_commit_does_not_extend_the_deadline() {
    let mut fx = fixture(params());
    fx.at(10, 0);
    fx.commit();
    fx.commit();
    fx.at(12, 0);
    let a = fx.reveal(0);
    let b = fx.reveal(1);
    fx.at(12, 1_000);
    fx.answer(b, yes());
    fx.at(12, 50_000);
    fx.answer(a, yes());
    let round = fx.round();
    assert_eq!(round["freeze_ns"], 1_000);
    assert_eq!(round["reveal_deadline_ns"], 1_000 + 60_000_000_000u64);
    let commits = fx.commits();
    assert!(commits.iter().all(|c| status(c) == "Correct"));
    // Earlier commit has the smaller global seq whatever the callback order was.
    assert!(commits[0]["seq"].as_u64() < commits[1]["seq"].as_u64());
}

#[test]
fn wrong_guess_returns_half_and_adds_half_to_the_pot() {
    let mut fx = fixture(params());
    fx.at(10, 0);
    fx.commit();
    fx.at(12, 0);
    let request = fx.reveal(0);
    let (credit, money, pots) = (fx.credit(), fx.money(), num(&fx.ledger()["round_pots"]));
    fx.answer(request, no());
    assert_eq!(status(&fx.commits()[0]), "Wrong");
    assert_eq!(fx.credit(), credit + 50);
    assert_eq!(num(&fx.round()["pot"]), 50);
    assert_eq!(num(&fx.ledger()["round_pots"]), pots + 50);
    assert_eq!(num(&fx.ledger()["open_stakes"]), 0);
    assert_eq!(fx.money(), money);
    assert_eq!(fx.round()["phase"], "Investigation");
}

#[test]
fn every_failure_shape_refunds_the_full_stake_and_blocks_reveal() {
    let shapes = [
        PromiseResult::Failed,
        PromiseResult::Successful(b"null".to_vec()),
        PromiseResult::Successful(b"not json".to_vec()),
        PromiseResult::Successful(br#"{"v":1}"#.to_vec()),
    ];
    for shape in shapes {
        let mut fx = fixture(params());
        fx.at(10, 0);
        fx.commit();
        fx.at(12, 0);
        let request = fx.reveal(0);
        let (credit, money) = (fx.credit(), fx.money());
        fx.answer(request, shape);
        assert_eq!(status(&fx.commits()[0]), "Refunded");
        assert_eq!(fx.credit(), credit + 100);
        assert_eq!(fx.money(), money);
        assert_eq!(num(&fx.ledger()["open_stakes"]), 0);
        assert_eq!(fx.round()["pending_checks"], 0);
        assert_eq!(fx.round()["phase"], "Investigation");
        let again = panic_text(|| {
            fx.reveal(0);
        });
        assert!(again.contains("E10"), "{again}");
        // The slot is free again: three more commits fit, a fourth does not.
        for _ in 0..3 {
            fx.commit();
        }
    }
}

#[test]
fn duplicate_guess_callback_changes_nothing() {
    let mut fx = fixture(params());
    fx.at(10, 0);
    fx.commit();
    fx.at(12, 0);
    let request = fx.reveal(0);
    fx.answer(request, no());
    let (credit, money, round) = (fx.credit(), fx.money(), fx.round());
    fx.answer(request, yes());
    fx.answer(request, PromiseResult::Failed);
    assert_eq!(status(&fx.commits()[0]), "Wrong");
    assert_eq!(fx.credit(), credit);
    assert_eq!(fx.money(), money);
    assert_eq!(fx.round(), round);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(150))]
    #[test]
    fn random_guess_sequences_conserve_money_and_stakes(
        ops in prop::collection::vec((0u8..4, 0u8..3), 1..40)
    ) {
        let mut fx = fixture(params());
        let money = fx.money();
        let mut block = 10u64;
        let mut inflight: Vec<(u64, u32)> = Vec::new();
        for (op, pick) in ops {
            block += 3;
            fx.at(block, block * 1_000);
            let commits = fx.commits();
            let open = commits
                .iter()
                .filter(|c| matches!(status(c), "Committed" | "Checking" | "Correct"))
                .count();
            let investigating = fx.round()["phase"] == "Investigation";
            match op {
                0 if open < 3 && investigating => {
                    fx.commit();
                }
                1 => {
                    let ready: Vec<u32> = commits
                        .iter()
                        .filter(|c| status(c) == "Committed")
                        .map(|c| c["commit_seq"].as_u64().unwrap() as u32)
                        .collect();
                    if let Some(&seq) = ready.get(pick as usize % ready.len().max(1)) {
                        let request = fx.reveal(seq);
                        inflight.push((request, seq));
                    }
                }
                _ => {
                    if !inflight.is_empty() {
                        let (request, _) = inflight.remove(pick as usize % inflight.len());
                        let result = match (op, pick) {
                            (2, _) => yes(),
                            (_, 0) => no(),
                            _ => PromiseResult::Failed,
                        };
                        fx.answer(request, result);
                    }
                }
            }
            let commits = fx.commits();
            let locked: u128 = commits
                .iter()
                .filter(|c| matches!(status(c), "Committed" | "Checking" | "Correct"))
                .map(|c| num(&c["stake"]))
                .sum();
            let checking = commits.iter().filter(|c| status(c) == "Checking").count();
            prop_assert_eq!(fx.money(), money);
            prop_assert_eq!(num(&fx.ledger()["open_stakes"]), locked);
            prop_assert_eq!(fx.round()["pending_checks"].as_u64().unwrap() as usize, checking);
        }
    }
}
