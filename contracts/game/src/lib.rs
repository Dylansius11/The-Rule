//! THE RULE game contract.
mod credit;
mod guess;
mod ledger;
mod log;
pub mod params;
mod play;
mod round;
mod views;
use borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, Value, json};
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, env, near};
use protocol::{Grammar, Hex32, Mode, Params, RefereeRequest, RefereeResponse};
use rule_core::{Play, Previous};

#[derive(BorshSerialize, BorshDeserialize)]
pub struct Player {
    index: u32,
    credit: u128,
    pending: bool,
}

/// Interned player identity; Team is resolved by the team implementation in P4.
#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum Entity {
    Solo(u32),
    Team(u32),
}

#[derive(BorshSerialize, BorshDeserialize, Default)]
pub struct EntityRound {
    attempts: u16,
    shares: u16,
    pot_contribution: u128,
    pending: bool,
    last_number: Option<u16>,
    last_word: u8,
    last_time_ns: u64,
    /// Open (Committed, Checking or Correct) commits of this entity in this round.
    open_commits: u8,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde", tag = "status")]
pub enum PlayAck {
    Known { verdict: bool, log_idx: u32 },
    Pending { request_id: u64, seq: u64 },
}

/// Round phase, in lifecycle order (SMART-CONTRACT 'Round phases').
#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Phase {
    Sealing,
    Investigation,
    Reveal,
    Opening,
    Settled,
    Cancelled,
    Void,
}

impl Phase {
    /// Wire name used by `RoundView.phase`.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Sealing => "Sealing",
            Self::Investigation => "Investigation",
            Self::Reveal => "Reveal",
            Self::Opening => "Opening",
            Self::Settled => "Settled",
            Self::Cancelled => "Cancelled",
            Self::Void => "Void",
        }
    }
    /// Settled, Cancelled or Void: nothing more happens to the round.
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Settled | Self::Cancelled | Self::Void)
    }
    /// The round has left Investigation and Reveal, so the mode may start its next round.
    pub const fn is_past_reveal(self) -> bool {
        self as u8 >= Self::Opening as u8
    }
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct Round {
    phase: Phase,
    start_ns: u64,
    slot_ns: u64,
    investigation_end_ns: Option<u64>,
    seed: [u8; 32],
    commit: Option<[u8; 32]>,
    header: Option<String>,
    pot: u128,
    allowance_left: u128,
    reveal_deadline_ns: u64,
    begin_pending: bool,
    log_len: u32,
    total_shares: u64,
    rule: Option<String>,
    salt: Option<[u8; 32]>,
    /// Commits made this round; the next commit gets this value as its `commit_seq`.
    commit_count: u32,
    /// Smallest-`seq` Correct commit so far, as `(seq, commit_seq)`.
    best: Option<(u64, u32)>,
    freeze_ns: Option<u64>,
    /// Guess checks in flight; `finalize` requires zero.
    pending_checks: u32,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub enum Request {
    Begin {
        mode: u8,
        round: u32,
    },
    Verdict {
        mode: u8,
        round: u32,
        entity: Entity,
        actor: AccountId,
        play: String,
        key: u64,
        seq: u64,
        timestamp: u64,
    },
    Withdraw {
        actor: AccountId,
        amount: u128,
    },
    Guess {
        mode: u8,
        round: u32,
        commit_seq: u32,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundView {
    demo: bool,
    mode: u8,
    round_id: u32,
    slot_ns: u64,
    sealing_started_ns: u64,
    begin_status: String,
    investigation_end_ns: Option<u64>,
    freeze_ns: Option<u64>,
    pending_checks: u32,
    opening_started_ns: Option<u64>,
    open_status: String,
    outcome: Option<Value>,
    phase: String,
    start_ns: u64,
    seed: Hex32,
    commit: Option<Hex32>,
    header: Option<Value>,
    pot: U128,
    allowance_left: U128,
    reveal_deadline_ns: u64,
    log_len: u32,
    rule: Option<Value>,
    salt: Option<Hex32>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ParamsView {
    #[serde(flatten)]
    params: Params,
    demo: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Game {
    params_state: params::StoredParams,
    demo: bool,
    rounds: LookupMap<(u8, u32), Round>,
    current: [Option<u32>; 2],
    active_rounds: Vec<(u8, u32)>,
    carry: [u128; 2],
    pending: LookupMap<u64, Request>,
    next_request_id: u64,
    compute_float: u128,
    players: LookupMap<AccountId, Player>,
    entities: LookupMap<(u8, u32, Entity), EntityRound>,
    seen: LookupMap<(u8, u32, u64), u32>,
    log: LookupMap<(u8, u32, u32), String>,
    next_player: u32,
    next_seq: u64,
    total_credit: u128,
    total_pots: u128,
    pending_credit: u128,
    storage_reserve: u128,
    platform_accrued: u128,
    commits: LookupMap<(u8, u32, u32), guess::Commit>,
    /// Stakes locked by open commits.
    total_stakes: u128,
}

impl Game {
    fn params(&self) -> Params {
        Params::from(&self.params_state)
    }
    fn execute(
        &self,
        request: &RefereeRequest,
        request_id: u64,
        deposit: u128,
        limits: protocol::params::ResourceLimits,
        params: &Params,
        callback: &str,
    ) {
        let outlayer: AccountId = params
            .referee
            .outlayer
            .parse()
            .expect("invalid OutLayer account");
        let args = json!({
            "source": {"WasmUrl": {"url": params.referee.urls[0], "hash": params.referee.hash, "build_target": params.referee.build_target}},
            "resource_limits": {"max_instructions": limits.instructions, "max_memory_mb": limits.memory_mb, "max_execution_seconds": limits.execution_seconds},
            "input_data": serde_json::to_string(request).expect("request serialization"), "secrets_ref": null,
            "response_format": "Json", "payer_account_id": null, "params": null
        });
        Promise::new(outlayer)
            .function_call(
                "request_execution",
                serde_json::to_vec(&args).expect("arguments serialization"),
                NearToken::from_yoctonear(deposit),
                Gas::from_gas(params.gas_outlayer),
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    callback,
                    serde_json::to_vec(&json!({"request_id":request_id}))
                        .expect("callback serialization"),
                    NearToken::from_yoctonear(0),
                    Gas::from_gas(params.gas_callback),
                ),
            )
            .detach();
    }
}

#[near]
impl Game {
    #[init]
    pub fn new(params: Params, demo: bool) -> Self {
        near_sdk::require!(
            !params.referee.urls.is_empty() && params.referee.build_target == "wasm32-wasip2",
            "E11"
        );
        near_sdk::require!(
            params.referee.outlayer.parse::<AccountId>().is_ok()
                && params.token.parse::<AccountId>().is_ok()
                && params.platform.parse::<AccountId>().is_ok(),
            "E11"
        );
        near_sdk::require!(
            params.round_period_ns > 0
                && params
                    .fee_split_bps
                    .iter()
                    .map(|x| u32::from(*x))
                    .sum::<u32>()
                    == 10_000,
            "E11"
        );
        near_sdk::require!(
            params.base_attempts.iter().all(|v| *v > 0) && params.share_cap.iter().all(|v| *v > 0),
            "E11"
        );
        near_sdk::require!(
            params
                .play_fee
                .0
                .checked_add(params.storage_charge_per_play.0)
                .is_some(),
            "E11"
        );
        if !demo {
            const HOUR: u64 = 3_600_000_000_000;
            const MINUTE: u64 = 60_000_000_000;
            let earliest = env::block_timestamp()
                .checked_add(2 * HOUR)
                .unwrap_or_else(|| env::panic_str("E11"));
            near_sdk::require!(
                params.genesis_ns >= earliest
                    && params.round_period_ns >= HOUR
                    && params.reveal_window_ns >= 10 * MINUTE
                    && params.begin_timeout_ns >= 10 * MINUTE
                    && params.open_timeout_ns >= 10 * MINUTE,
                "E11"
            );
        }
        Self {
            params_state: params.into(),
            demo,
            rounds: LookupMap::new(b"r"),
            current: [None, None],
            active_rounds: Vec::new(),
            carry: [0, 0],
            pending: LookupMap::new(b"p"),
            next_request_id: 0,
            compute_float: 0,
            players: LookupMap::new(b"a"),
            entities: LookupMap::new(b"e"),
            seen: LookupMap::new(b"s"),
            log: LookupMap::new(b"l"),
            next_player: 0,
            next_seq: 0,
            total_credit: 0,
            total_pots: 0,
            pending_credit: 0,
            storage_reserve: 0,
            platform_accrued: 0,
            commits: LookupMap::new(b"c"),
            total_stakes: 0,
        }
    }

    pub fn get_params(&self) -> ParamsView {
        ParamsView {
            params: self.params(),
            demo: self.demo,
        }
    }

    #[payable]
    pub fn fund_compute(&mut self) {
        self.compute_float = self
            .compute_float
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("E11");
    }

    #[payable]
    pub fn seed_pot(&mut self, mode: Mode) {
        self.seed_pot_inner(mode);
    }
    pub fn start_round(&mut self, mode: Mode) -> u64 {
        self.start_round_inner(mode)
    }
    #[private]
    pub fn on_begin(&mut self, request_id: u64) {
        self.on_begin_inner(request_id);
    }
    pub fn advance(&mut self, mode: Mode) {
        self.advance_inner(mode);
    }
    pub fn get_round(&self, mode: Mode, id: Option<u32>) -> Option<RoundView> {
        self.get_round_inner(mode, id)
    }
    pub fn get_active_rounds(&self) -> Vec<RoundView> {
        self.get_active_rounds_inner()
    }
    pub fn get_next_slot(&self, mode: Mode) -> Value {
        self.get_next_slot_inner(mode)
    }
    #[payable]
    pub fn deposit_credit(&mut self) {
        self.deposit_credit_inner();
    }
    #[payable]
    pub fn withdraw_credit(&mut self, amount: U128) {
        self.withdraw_credit_inner(amount);
    }
    #[private]
    pub fn on_withdraw(&mut self, request_id: u64) {
        self.on_withdraw_inner(request_id);
    }
    pub fn play(&mut self, mode: Mode, number: u16, word: String) -> PlayAck {
        self.play_inner(mode, number, word)
    }
    #[private]
    pub fn on_verdict(&mut self, request_id: u64) {
        self.on_verdict_inner(request_id);
    }
    pub fn get_log(
        &self,
        mode: Mode,
        id: u32,
        from_idx: u32,
        limit: u32,
    ) -> Vec<protocol::events::LogRow> {
        self.get_log_inner(mode, id, from_idx, limit)
    }
    pub fn get_player(&self, account: AccountId) -> Option<Value> {
        self.get_player_inner(account)
    }
    pub fn get_entity(&self, mode: Mode, id: u32, account: AccountId) -> views::EntityView {
        self.get_entity_inner(mode, id, account)
    }
    pub fn get_verdict(&self, mode: Mode, id: u32, play: Play) -> Option<protocol::events::LogRow> {
        self.get_verdict_inner(mode, id, play)
    }
    pub fn get_word_list(&self) -> Vec<String> {
        self.get_word_list_inner()
    }
    pub fn get_ledger(&self) -> ledger::Ledger {
        self.get_ledger_inner()
    }
}
