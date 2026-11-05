//! Shared fixture for the unit tests: a demo game with a begun round and helpers to drive it.
#![allow(dead_code)]
use game::{Game, PlayAck};
use near_sdk::serde_json::{Value, json};
use near_sdk::{
    NearToken, PromiseResult, RuntimeFeesConfig, test_utils::VMContextBuilder, testing_env,
};
use protocol::{CommitPreimage, Entity, Hex32, Mode, Params, RuleHex};
use rule_core::CanonicalRule;
use std::collections::HashMap;

/// Salt of every guess commit in these tests.
pub const SALT: [u8; 32] = [7; 32];
/// Salt the (mock) referee sealed the round with.
pub const ROUND_SALT: [u8; 32] = [3; 32];
pub const DEPOSIT: u128 = 1_000_000;
pub const INVESTIGATION_END: u64 = 3_600_000_000_000;

/// Message of the panic raised by `f`; empty string when it does not panic.
pub fn panic_text(f: impl FnOnce()) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(()) => String::new(),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| (*s).to_owned()))
            .unwrap_or_default(),
    }
}

pub fn params() -> Params {
    let limits = json!({"instructions":1000000000,"memory_mb":128,"execution_seconds":5});
    near_sdk::serde_json::from_value(json!({
        "play_fee":"10000","fee_split_bps":[8000,1500,500],"storage_charge_per_play":"100","storage_charge_account":"100","storage_charge_team":"100",
        "stake_bps":[100,200],"stake_min":"100","wrong_return_bps":5000,"solved_split_bps":[4000,4000,1000,1000],"unsolved_split_bps":[4000,5000,1000],
        "genesis_ns":0,"round_period_ns":86400000000000u64,"mode_offset_ns":[0,0],"investigation_max_ns":3600000000000u64,"reveal_window_ns":60000000000u64,"begin_timeout_ns":3600000000000u64,"open_timeout_ns":3600000000000u64,
        "min_reveal_delay_blocks":2,"base_attempts":[25,50],"lock_tiers":[],"attempt_cap":[125,250],"share_cap":[25,50],"round_allowance":"500000","mint_base":"100","max_team_size":5,
        "referee":{"outlayer":"outlayer.testnet","urls":["https://example.com/referee.wasm"],"hash":"0000000000000000000000000000000000000000000000000000000000000000","build_target":"wasm32-wasip2"},
        "resource_limits":{"begin":limits,"verdict":limits,"guess":limits,"open":limits},"outlayer_deposit":{"begin":"0","verdict":"0","guess":"0","open":"0"},"gas_outlayer":100000000000000u64,"gas_callback":60000000000000u64,"gas_mint":10000000000000u64,"token":"token.testnet","platform":"platform.testnet","chain_id":"testnet"
    })).unwrap()
}

pub struct Fx {
    pub ctx: VMContextBuilder,
    pub game: Game,
    /// The rule the mock referee sealed; guesses reveal exactly this rule.
    pub rule: CanonicalRule,
    actors: HashMap<String, u32>,
}

pub fn deliver_env(ctx: &VMContextBuilder, result: PromiseResult) {
    testing_env!(
        ctx.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

pub fn fixture(p: Params) -> Fx {
    fixture_seeded(p, 0)
}

pub fn fixture_seeded(p: Params, seed: u128) -> Fx {
    fixture_with(p, seed, "rare", |_, _| {})
}

/// Function-call receipts created since the last `testing_env!`, as `(receiver, method, args, deposit)`.
pub fn calls() -> Vec<(String, String, Value, u128)> {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight {
                    method_name,
                    args,
                    attached_deposit,
                    ..
                } => Some((
                    receiver.clone(),
                    String::from_utf8(method_name).unwrap(),
                    near_sdk::serde_json::from_slice(&args).unwrap_or(Value::Null),
                    attached_deposit.as_yoctonear(),
                )),
                _ => None,
            })
        })
        .collect()
}

/// Like `fixture_seeded`, with `before_begin` run after the account deposit and before the round
/// starts (for example to place RULE locks for round 0).
pub fn fixture_with(
    p: Params,
    seed: u128,
    bucket: &str,
    before_begin: impl FnOnce(&mut Game, &mut VMContextBuilder),
) -> Fx {
    // The mocked blockchain keeps its storage across `testing_env!`: start every fixture empty.
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut ctx = VMContextBuilder::new();
    ctx.prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(DEPOSIT));
    testing_env!(ctx.build());
    let mut game = Game::new(p, true);
    if seed > 0 {
        ctx.attached_deposit(NearToken::from_yoctonear(seed));
        testing_env!(ctx.build());
        game.seed_pot(Mode::Solo);
        ctx.attached_deposit(NearToken::from_yoctonear(DEPOSIT));
        testing_env!(ctx.build());
    }
    game.deposit_credit();
    before_begin(&mut game, &mut ctx);
    testing_env!(ctx.build());
    let (rule, _) = rule_core::sample(b"guess-tests");
    let commit = protocol::round_commitment(&rule, &ROUND_SALT);
    let begin = json!({"commit":commit,"header":{"tier":"daily","bucket":bucket,"grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    let request = game.start_round(Mode::Solo);
    deliver_env(
        &ctx,
        PromiseResult::Successful(begin.to_string().into_bytes()),
    );
    game.on_begin(request);
    let actors = HashMap::from([("bob.near".to_owned(), 0)]);
    Fx {
        ctx,
        game,
        rule,
        actors,
    }
}

impl Fx {
    pub fn at(&mut self, block: u64, ns: u64) {
        self.ctx.block_height(block).block_timestamp(ns);
        testing_env!(self.ctx.build());
    }

    /// Switch the caller; a first-time actor is registered with `DEPOSIT` credit.
    pub fn actor(&mut self, name: &str) {
        self.ctx.predecessor_account_id(name.parse().unwrap());
        testing_env!(self.ctx.build());
        if !self.actors.contains_key(name) {
            self.ctx
                .attached_deposit(NearToken::from_yoctonear(DEPOSIT));
            testing_env!(self.ctx.build());
            self.game.deposit_credit();
            let index = u32::try_from(self.actors.len()).unwrap();
            self.actors.insert(name.to_owned(), index);
        }
    }

    pub fn me(&self) -> String {
        self.ctx.build().predecessor_account_id.to_string()
    }

    fn index(&self) -> u32 {
        self.actors[&self.me()]
    }

    pub fn hash_for(&self, salt: &[u8; 32]) -> Hex32 {
        let c = self.ctx.build();
        protocol::commit_hash(&CommitPreimage {
            chain: "testnet",
            game: c.current_account_id.as_str(),
            mode: Mode::Solo,
            round: 0,
            actor: c.predecessor_account_id.as_str(),
            entity: Entity::Solo(self.index()),
            guess: &self.rule,
            salt,
        })
    }

    pub fn commit(&mut self) -> Value {
        let hash = self.hash_for(&SALT);
        near_sdk::serde_json::to_value(self.game.commit_guess(Mode::Solo, hash)).unwrap()
    }

    pub fn rule_hex(&self) -> String {
        near_sdk::serde_json::to_value(RuleHex(self.rule.clone()))
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned()
    }

    pub fn reveal(&mut self, commit_seq: u32) -> u64 {
        // Each helper call models a separate receipt, even at the same block and timestamp.
        // Otherwise consecutive reveals incorrectly share one prepaid-gas budget.
        testing_env!(self.ctx.build());
        let hex = self.rule_hex();
        self.game
            .reveal_guess(Mode::Solo, commit_seq, hex, Hex32(SALT))
    }

    pub fn answer(&mut self, request: u64, result: PromiseResult) {
        deliver_env(&self.ctx, result);
        self.game.on_guess(request);
    }

    /// Pay for one play; returns the pending referee request id.
    pub fn play(&mut self, number: u16, word: &str) -> u64 {
        match self.game.play(Mode::Solo, number, word.into()) {
            PlayAck::Pending { request_id, .. } => request_id,
            PlayAck::Known { .. } => panic!("expected a pending play"),
        }
    }

    pub fn verdict(&mut self, request: u64, v: u8) {
        deliver_env(
            &self.ctx,
            PromiseResult::Successful(format!("{{\"v\":{v}}}").into_bytes()),
        );
        self.game.on_verdict(request);
    }

    /// `finalize` repeatedly until the round is Opening; returns `(calls, open request id)`.
    pub fn finalize_all(&mut self) -> (u32, u64) {
        let mut calls = 0;
        loop {
            calls += 1;
            if let Some(request) = self.game.finalize(Mode::Solo) {
                return (calls, request);
            }
            assert!(calls < 100, "finalize never completed");
        }
    }

    /// Let Investigation end by time and wait out the reveal window (no commits needed).
    pub fn run_to_finalize(&mut self, block: u64) {
        self.at(block, INVESTIGATION_END);
        self.game.advance(Mode::Solo);
        let deadline = self.round()["reveal_deadline_ns"].as_u64().unwrap();
        self.at(block + 1, deadline);
    }

    /// Referee `open` answer for the round: the real rule and salt.
    pub fn open_ok(&self) -> PromiseResult {
        self.open_with(ROUND_SALT)
    }

    pub fn open_with(&self, salt: [u8; 32]) -> PromiseResult {
        let value = json!({"rule":self.rule,"salt":Hex32(salt)});
        PromiseResult::Successful(value.to_string().into_bytes())
    }

    pub fn on_open(&mut self, request: u64, result: PromiseResult) {
        deliver_env(&self.ctx, result);
        self.game.on_open(request);
    }

    pub fn round(&self) -> Value {
        near_sdk::serde_json::to_value(self.game.get_round(Mode::Solo, None).unwrap()).unwrap()
    }

    pub fn commits(&self) -> Vec<Value> {
        self.game
            .get_commits(Mode::Solo, 0, 0, 200)
            .into_iter()
            .map(|c| near_sdk::serde_json::to_value(c).unwrap())
            .collect()
    }

    pub fn ledger(&self) -> Value {
        near_sdk::serde_json::to_value(self.game.get_ledger()).unwrap()
    }

    pub fn credit(&self) -> u128 {
        credit_of(&self.game, &self.me())
    }

    pub fn claimable(&self, who: &str) -> u128 {
        num(&near_sdk::serde_json::to_value(self.game.get_claimable(
            Mode::Solo,
            0,
            who.parse().unwrap(),
        ))
        .unwrap())
    }

    pub fn term(&self, key: &str) -> u128 {
        num(&self.ledger()[key])
    }

    /// Every yocto the contract tracks outside its own balance; constant across every operation
    /// except the ones that bring money in (deposits, fees, seeds).
    pub fn money(&self) -> u128 {
        [
            "credit",
            "round_pots",
            "open_stakes",
            "claimable",
            "carry",
            "storage_reserve",
            "platform_accrued",
            "compute_float",
            "pending_credit",
        ]
        .iter()
        .map(|k| self.term(k))
        .sum()
    }
}

pub fn credit_of(game: &Game, who: &str) -> u128 {
    num(&game.get_player(who.parse().unwrap()).unwrap()["credit"])
}

pub fn num(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

pub fn yes() -> PromiseResult {
    PromiseResult::Successful(br#"{"correct":true}"#.to_vec())
}

pub fn no() -> PromiseResult {
    PromiseResult::Successful(br#"{"correct":false}"#.to_vec())
}

pub fn status(c: &Value) -> &str {
    c["status"].as_str().unwrap()
}
