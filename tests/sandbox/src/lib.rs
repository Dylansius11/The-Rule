//! Sandbox integration tests using a local mock OutLayer, never testnet evidence.
use serde_json::{Value, json};
use std::path::PathBuf;

/// Path of a built wasm: `game`, `token` or `mock_outlayer`. Override with `GAME_WASM`,
/// `TOKEN_WASM` or `MOCK_OUTLAYER_WASM`; otherwise they are read from `$CARGO_TARGET_DIR`.
pub fn artifact(name: &str) -> PathBuf {
    let (variable, relative) = match name {
        "game" => ("GAME_WASM", "near/game/game.wasm"),
        "token" => ("TOKEN_WASM", "near/token/token.wasm"),
        _ => (
            "MOCK_OUTLAYER_WASM",
            "wasm32-unknown-unknown/release/mock_outlayer.wasm",
        ),
    };
    if let Some(path) = std::env::var_os(variable) {
        return path.into();
    }
    PathBuf::from(
        std::env::var_os("CARGO_TARGET_DIR")
            .unwrap_or_else(|| panic!("set CARGO_TARGET_DIR or {variable}")),
    )
    .join(relative)
}

pub fn params(outlayer: &str) -> Value {
    let limits = json!({"instructions":1000000000,"memory_mb":128,"execution_seconds":5});
    json!({
        "play_fee":"10000000000000000000000","fee_split_bps":[8000,1500,500],
        "storage_charge_per_play":"1000000000000000000000","storage_charge_account":"1000000000000000000000","storage_charge_team":"1000000000000000000000",
        "stake_bps":[100,200],"stake_min":"100000000000000000000000","wrong_return_bps":5000,
        "solved_split_bps":[4000,4000,1000,1000],"unsolved_split_bps":[4000,5000,1000],
        "genesis_ns":0,"round_period_ns":86400000000000u64,"mode_offset_ns":[0,0],
        "investigation_max_ns":3600000000000u64,"reveal_window_ns":60000000000u64,"begin_timeout_ns":3600000000000u64,"open_timeout_ns":3600000000000u64,
        "min_reveal_delay_blocks":2,"base_attempts":[1,50],"lock_tiers":[],"attempt_cap":[125,250],"share_cap":[25,50],
        "round_allowance":"500000000000000000000000","mint_base":"100000000000000000000","max_team_size":5,
        "referee":{"outlayer":outlayer,"urls":["https://example.com/referee.wasm"],"hash":"0000000000000000000000000000000000000000000000000000000000000000","build_target":"wasm32-wasip2"},
        "resource_limits":{"begin":limits,"verdict":limits,"guess":limits,"open":limits},
        "outlayer_deposit":{"begin":"0","verdict":"0","guess":"0","open":"0"},
        "gas_outlayer":100000000000000u64,"gas_callback":60000000000000u64,"gas_mint":10000000000000u64,
        "token":"token.testnet","platform":"platform.testnet","chain_id":"testnet"
    })
}
