//! Idempotent game-to-token operations. Amounts use canonical decimal strings.
use crate::params::Amount;
use alloc::string::String;
use serde::{Deserialize, Serialize};

/// Permanently funded ceiling for one operation record, including its trie key.
pub const TOKEN_OPERATION_STORAGE_BYTES: u64 = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenOperationKind {
    Mint,
    Unlock,
}

/// The immutable game request id binds the kind, recipient and amount for its lifetime.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenOperation {
    pub operation_id: u64,
    pub kind: TokenOperationKind,
    pub account_id: String,
    pub amount: Amount,
}

/// Only terminal business outcomes appear here. A transport failure is not a rejection.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenOperationStatus {
    Applied,
    ReceiverUnregistered,
    InsufficientBalance,
    CapExceeded,
    InvalidAmount,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenOutcome {
    pub operation: TokenOperation,
    pub status: TokenOperationStatus,
}

/// Non-refundable contributions fund retained outcomes, separately from NEP-145 registration.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TokenOperationFunding {
    pub available: Amount,
    pub cost_per_operation: Amount,
    pub completed: u64,
}
