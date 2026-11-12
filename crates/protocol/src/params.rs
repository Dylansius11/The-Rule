//! Immutable game initialization parameters, using string-encoded integer amounts.
use crate::Hex32;
use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};

/// Amount in yoctoNEAR or 18-decimal RULE, serialized as a decimal string.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Amount(pub u128);
impl Serialize for Amount {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use alloc::string::ToString;
        serializer.serialize_str(&self.0.to_string())
    }
}
impl<'de> Deserialize<'de> for Amount {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        if s.is_empty()
            || !s.bytes().all(|b| b.is_ascii_digit())
            || (s.len() > 1 && s.starts_with('0'))
        {
            return Err(D::Error::custom("invalid decimal amount"));
        }
        s.parse().map(Self).map_err(D::Error::custom)
    }
}
/// A lock threshold and the corresponding number of extra attempts.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockTier {
    pub amount: Amount,
    pub extra_attempts: u16,
}
/// Public pointer to an encrypted OutLayer profile, never the secret value.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecretsRef {
    pub profile: String,
    pub account_id: String,
}
/// Pinned referee artifact and service account.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefereeConfig {
    pub outlayer: String,
    pub urls: Vec<String>,
    pub hash: Hex32,
    pub build_target: String,
    /// Preselected-rule Demo only; production initialization rejects this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub demo_secrets_ref: Option<SecretsRef>,
}
/// Per-execution OutLayer limits, measured and fixed at deployment.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceLimits {
    pub instructions: u64,
    pub memory_mb: u32,
    pub execution_seconds: u32,
}
/// Values for begin, verdict, guess and open in that order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerOp<T> {
    pub begin: T,
    pub verdict: T,
    pub guess: T,
    pub open: T,
}
/// Immutable game parameters. Mode-indexed arrays are ordered solo, team.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub play_fee: Amount,
    pub fee_split_bps: [u16; 3],
    pub storage_charge_per_play: Amount,
    pub storage_charge_account: Amount,
    pub storage_charge_team: Amount,
    pub stake_bps: [u16; 2],
    pub stake_min: Amount,
    pub wrong_return_bps: u16,
    pub solved_split_bps: [u16; 4],
    pub unsolved_split_bps: [u16; 3],
    pub genesis_ns: u64,
    pub round_period_ns: u64,
    pub mode_offset_ns: [u64; 2],
    pub investigation_max_ns: u64,
    pub reveal_window_ns: u64,
    pub begin_timeout_ns: u64,
    pub open_timeout_ns: u64,
    pub min_reveal_delay_blocks: u64,
    pub base_attempts: [u16; 2],
    pub lock_tiers: Vec<LockTier>,
    pub attempt_cap: [u16; 2],
    pub share_cap: [u16; 2],
    pub round_allowance: Amount,
    pub mint_base: Amount,
    pub max_team_size: u8,
    pub referee: RefereeConfig,
    pub resource_limits: PerOp<ResourceLimits>,
    pub outlayer_deposit: PerOp<Amount>,
    pub gas_outlayer: u64,
    pub gas_callback: u64,
    pub gas_mint: u64,
    pub token: String,
    pub platform: String,
    pub chain_id: String,
}
