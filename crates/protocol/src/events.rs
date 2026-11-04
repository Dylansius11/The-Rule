//! Event payloads for the state transitions described in SMART-CONTRACT.
use crate::{Hex32, Mode, Play, params::Amount};
use alloc::string::String;
use serde::{Deserialize, Serialize};

/// Settled log row; entity tag 0 is solo and 1 is team.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogRow {
    pub log_idx: u32,
    pub seq: u64,
    pub entity_tag: u8,
    pub entity_id: u32,
    pub actor: u32,
    pub play: Play,
    pub verdict: bool,
    pub minted: Amount,
}
/// A successfully delivered verdict.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaySettled {
    pub mode: Mode,
    pub round_id: u32,
    pub row: LogRow,
}
/// A play returned to its payer after a failed callback.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlayRefunded {
    pub request_id: u64,
    pub reason: String,
}
/// A failed asynchronous mint; the verdict remains settled.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MintFailed {
    pub mode: Mode,
    pub round_id: u32,
    pub log_idx: u32,
}
/// Public evidence that an opened rule did not match its commitment.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoundVoid {
    pub expected: Hex32,
    pub got: Hex32,
}
