//! Economic defaults. Deployment-specific referee, gas, accounts, genesis, and
//! measured execution limits/deposits remain supplied by the caller.
use protocol::{
    Params,
    params::{Amount, LockTier},
};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const RULE: u128 = 1_000_000_000_000_000_000;
const MINUTE: u64 = 60_000_000_000;
const HOUR: u64 = 60 * MINUTE;

/// Fill the published production economics; deployment-specific fields are retained.
/// [I] Provisional storage allowances: 160 bytes per account and 768 per play
/// include headroom over one observed 109-byte account, 82-byte entity record,
/// and 420-byte first solo play. The 500-byte team estimate is from the
/// specification, not a measured or derived maximum; re-measure in P4.
pub fn production_defaults(mut params: Params) -> Params {
    params.play_fee = Amount(NEAR / 100);
    params.fee_split_bps = [8000, 1500, 500];
    params.storage_charge_account = Amount(160 * 10_000_000_000_000_000_000);
    params.storage_charge_per_play = Amount(768 * 10_000_000_000_000_000_000);
    params.storage_charge_team = Amount(500 * 10_000_000_000_000_000_000);
    params.stake_bps = [100, 200];
    params.stake_min = Amount(NEAR / 10);
    params.wrong_return_bps = 5000;
    params.solved_split_bps = [4000, 4000, 1000, 1000];
    params.unsolved_split_bps = [4000, 5000, 1000];
    params.round_period_ns = 24 * HOUR;
    params.mode_offset_ns = [0, 12 * HOUR];
    params.investigation_max_ns = 23 * HOUR;
    params.reveal_window_ns = 30 * MINUTE;
    params.begin_timeout_ns = HOUR;
    params.open_timeout_ns = 6 * HOUR;
    params.min_reveal_delay_blocks = 2;
    params.base_attempts = [25, 50];
    params.lock_tiers = [(1000, 25), (5000, 50), (20000, 100)]
        .into_iter()
        .map(|(amount, extra_attempts)| LockTier {
            amount: Amount(amount * RULE),
            extra_attempts,
        })
        .collect();
    params.attempt_cap = [125, 250];
    params.share_cap = [25, 50];
    params.round_allowance = Amount(500_000 * RULE);
    params.mint_base = Amount(100 * RULE);
    params.max_team_size = 5;
    params
}

/// Fill the published Demo Mode economics and shorter lifecycle timings.
pub fn demo_defaults(params: Params) -> Params {
    let mut params = production_defaults(params);
    params.round_period_ns = 15 * MINUTE;
    params.mode_offset_ns = [0, 0];
    params.investigation_max_ns = 10 * MINUTE;
    params.reveal_window_ns = 2 * MINUTE;
    params.begin_timeout_ns = 5 * MINUTE;
    params.open_timeout_ns = 10 * MINUTE;
    params.round_allowance = Amount(50_000 * RULE);
    params
}

/// Borsh representation of immutable protocol parameters.
#[near_sdk::near(serializers = [borsh])]
pub(crate) struct StoredParams {
    play_fee: u128,
    fee_split_bps: [u16; 3],
    storage_charge_per_play: u128,
    storage_charge_account: u128,
    storage_charge_team: u128,
    stake_bps: [u16; 2],
    stake_min: u128,
    wrong_return_bps: u16,
    solved_split_bps: [u16; 4],
    unsolved_split_bps: [u16; 3],
    genesis_ns: u64,
    round_period_ns: u64,
    mode_offset_ns: [u64; 2],
    investigation_max_ns: u64,
    reveal_window_ns: u64,
    begin_timeout_ns: u64,
    open_timeout_ns: u64,
    min_reveal_delay_blocks: u64,
    base_attempts: [u16; 2],
    lock_tiers: Vec<(u128, u16)>,
    attempt_cap: [u16; 2],
    share_cap: [u16; 2],
    round_allowance: u128,
    mint_base: u128,
    max_team_size: u8,
    outlayer: String,
    urls: Vec<String>,
    hash: [u8; 32],
    build_target: String,
    resource_limits: [(u64, u32, u32); 4],
    outlayer_deposit: [u128; 4],
    gas_outlayer: u64,
    gas_callback: u64,
    gas_mint: u64,
    token: String,
    platform: String,
    chain_id: String,
}

impl From<Params> for StoredParams {
    fn from(p: Params) -> Self {
        let limits = |v: protocol::params::ResourceLimits| {
            (v.instructions, v.memory_mb, v.execution_seconds)
        };
        Self {
            play_fee: p.play_fee.0,
            fee_split_bps: p.fee_split_bps,
            storage_charge_per_play: p.storage_charge_per_play.0,
            storage_charge_account: p.storage_charge_account.0,
            storage_charge_team: p.storage_charge_team.0,
            stake_bps: p.stake_bps,
            stake_min: p.stake_min.0,
            wrong_return_bps: p.wrong_return_bps,
            solved_split_bps: p.solved_split_bps,
            unsolved_split_bps: p.unsolved_split_bps,
            genesis_ns: p.genesis_ns,
            round_period_ns: p.round_period_ns,
            mode_offset_ns: p.mode_offset_ns,
            investigation_max_ns: p.investigation_max_ns,
            reveal_window_ns: p.reveal_window_ns,
            begin_timeout_ns: p.begin_timeout_ns,
            open_timeout_ns: p.open_timeout_ns,
            min_reveal_delay_blocks: p.min_reveal_delay_blocks,
            base_attempts: p.base_attempts,
            lock_tiers: p
                .lock_tiers
                .into_iter()
                .map(|t| (t.amount.0, t.extra_attempts))
                .collect(),
            attempt_cap: p.attempt_cap,
            share_cap: p.share_cap,
            round_allowance: p.round_allowance.0,
            mint_base: p.mint_base.0,
            max_team_size: p.max_team_size,
            outlayer: p.referee.outlayer,
            urls: p.referee.urls,
            hash: p.referee.hash.0,
            build_target: p.referee.build_target,
            resource_limits: [
                limits(p.resource_limits.begin),
                limits(p.resource_limits.verdict),
                limits(p.resource_limits.guess),
                limits(p.resource_limits.open),
            ],
            outlayer_deposit: [
                p.outlayer_deposit.begin.0,
                p.outlayer_deposit.verdict.0,
                p.outlayer_deposit.guess.0,
                p.outlayer_deposit.open.0,
            ],
            gas_outlayer: p.gas_outlayer,
            gas_callback: p.gas_callback,
            gas_mint: p.gas_mint,
            token: p.token,
            platform: p.platform,
            chain_id: p.chain_id,
        }
    }
}

impl From<&StoredParams> for Params {
    fn from(p: &StoredParams) -> Self {
        use protocol::params::{PerOp, RefereeConfig, ResourceLimits};
        let limits = |(instructions, memory_mb, execution_seconds)| ResourceLimits {
            instructions,
            memory_mb,
            execution_seconds,
        };
        Params {
            play_fee: Amount(p.play_fee),
            fee_split_bps: p.fee_split_bps,
            storage_charge_per_play: Amount(p.storage_charge_per_play),
            storage_charge_account: Amount(p.storage_charge_account),
            storage_charge_team: Amount(p.storage_charge_team),
            stake_bps: p.stake_bps,
            stake_min: Amount(p.stake_min),
            wrong_return_bps: p.wrong_return_bps,
            solved_split_bps: p.solved_split_bps,
            unsolved_split_bps: p.unsolved_split_bps,
            genesis_ns: p.genesis_ns,
            round_period_ns: p.round_period_ns,
            mode_offset_ns: p.mode_offset_ns,
            investigation_max_ns: p.investigation_max_ns,
            reveal_window_ns: p.reveal_window_ns,
            begin_timeout_ns: p.begin_timeout_ns,
            open_timeout_ns: p.open_timeout_ns,
            min_reveal_delay_blocks: p.min_reveal_delay_blocks,
            base_attempts: p.base_attempts,
            lock_tiers: p
                .lock_tiers
                .iter()
                .map(|&(amount, extra_attempts)| LockTier {
                    amount: Amount(amount),
                    extra_attempts,
                })
                .collect(),
            attempt_cap: p.attempt_cap,
            share_cap: p.share_cap,
            round_allowance: Amount(p.round_allowance),
            mint_base: Amount(p.mint_base),
            max_team_size: p.max_team_size,
            referee: RefereeConfig {
                outlayer: p.outlayer.clone(),
                urls: p.urls.clone(),
                hash: protocol::Hex32(p.hash),
                build_target: p.build_target.clone(),
            },
            resource_limits: PerOp {
                begin: limits(p.resource_limits[0]),
                verdict: limits(p.resource_limits[1]),
                guess: limits(p.resource_limits[2]),
                open: limits(p.resource_limits[3]),
            },
            outlayer_deposit: PerOp {
                begin: Amount(p.outlayer_deposit[0]),
                verdict: Amount(p.outlayer_deposit[1]),
                guess: Amount(p.outlayer_deposit[2]),
                open: Amount(p.outlayer_deposit[3]),
            },
            gas_outlayer: p.gas_outlayer,
            gas_callback: p.gas_callback,
            gas_mint: p.gas_mint,
            token: p.token.clone(),
            platform: p.platform.clone(),
            chain_id: p.chain_id.clone(),
        }
    }
}
