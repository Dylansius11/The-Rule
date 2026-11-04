//! Replay of a disclosed round using the shared grammar and commitment implementation.
use protocol::{Hex32, round_commitment};
use rule_core::{CanonicalRule, Play, eval};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Row {
    pub log_idx: u32,
    pub seq: u64,
    pub play_key: String,
    pub play: Play,
    pub verdict: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Round {
    pub phase: String,
    pub log_len: u32,
    pub rule: Option<CanonicalRule>,
    pub salt: Option<Hex32>,
    pub commit: Option<Hex32>,
}

/// Portable export format: the unmodified round view and its complete log.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Export {
    pub round: Round,
    pub rows: Vec<Row>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Verification {
    Pass { matched: usize, total: usize },
    Fail { reason: String },
}

fn fail(reason: String) -> Verification {
    Verification::Fail { reason }
}

fn row_failure(rule: &CanonicalRule, row: &Row) -> Option<String> {
    let key = row.play_key.as_bytes();
    if key.is_empty()
        || (key.len() > 1 && key[0] == b'0')
        || !key.iter().all(u8::is_ascii_digit)
        || row.play_key.parse::<u64>().ok() != Some(row.play.play_key().0)
    {
        return Some(format!("PlayKeyMismatch at index {}", row.log_idx));
    }
    let expected = eval(rule, &row.play);
    (expected != row.verdict).then(|| {
        format!(
            "verdict mismatch at index {}: recorded {}, expected {}",
            row.log_idx, row.verdict, expected
        )
    })
}

/// Replay verdicts, reporting the first disagreement in row order.
pub fn consistent(rule: &CanonicalRule, rows: &[Row]) -> Verification {
    for row in rows {
        if let Some(reason) = row_failure(rule, row) {
            return fail(reason);
        }
    }
    Verification::Pass {
        matched: rows.len(),
        total: rows.len(),
    }
}

/// Check the commitment, complete index range, unique sequence numbers and every verdict.
pub fn verify_round(
    rows: &[Row],
    rule: &CanonicalRule,
    salt: Hex32,
    commit: Hex32,
    log_len: u32,
) -> Verification {
    if round_commitment(rule, &salt.0) != commit {
        return fail("commitment mismatch".into());
    }
    let mut sequences = HashSet::with_capacity(rows.len());
    for (i, row) in rows.iter().enumerate() {
        if u64::from(row.log_idx) != i as u64 {
            let kind = if u64::from(row.log_idx) < i as u64 {
                "duplicate index"
            } else if rows[i + 1..]
                .iter()
                .any(|later| u64::from(later.log_idx) == i as u64)
            {
                "reordered index"
            } else {
                "missing index"
            };
            return fail(format!("{kind} at position {i}: found {}", row.log_idx));
        }
        if !sequences.insert(row.seq) {
            return fail(format!(
                "duplicate sequence at index {}: {}",
                row.log_idx, row.seq
            ));
        }
        if let Some(reason) = row_failure(rule, row) {
            return fail(reason);
        }
    }
    if rows.len() != log_len as usize {
        return fail(format!(
            "log length mismatch: expected {log_len}, found {}",
            rows.len()
        ));
    }
    Verification::Pass {
        matched: rows.len(),
        total: rows.len(),
    }
}

pub fn verify_export(export: &Export) -> Verification {
    if export.round.phase != "Settled" {
        return fail(format!(
            "round is {}, not Settled; replay unavailable",
            export.round.phase
        ));
    }
    match (&export.round.rule, export.round.salt, export.round.commit) {
        (Some(rule), Some(salt), Some(commit)) => {
            verify_round(&export.rows, rule, salt, commit, export.round.log_len)
        }
        _ => fail("settled round is missing rule, salt or commitment".into()),
    }
}
