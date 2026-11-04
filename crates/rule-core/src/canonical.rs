//! Canonical bytes: ASCII g1, form, count, then (atom ID, negation) pairs.
use crate::rule::{CanonicalRule, RuleError};
use alloc::vec::Vec;

/// Encode a valid rule without serializer-dependent representation.
pub fn encode(rule: &CanonicalRule) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + 2 * rule.literals().len());
    out.extend_from_slice(b"g1");
    out.push(rule.form() as u8);
    out.push(rule.literals().len() as u8);
    for lit in rule.literals() {
        out.extend_from_slice(&[lit.atom.id(), u8::from(lit.negated)]);
    }
    out
}
/// Decode canonical bytes, rejecting trailing bytes and noncanonical literal order.
pub fn decode(bytes: &[u8]) -> Result<CanonicalRule, RuleError> {
    if bytes.len() < 4 {
        return Err(RuleError::Length);
    }
    if &bytes[..2] != b"g1" {
        return Err(RuleError::Version);
    }
    let n = usize::from(bytes[3]);
    if n > 2 || bytes.len() != 4 + 2 * n {
        return Err(RuleError::Length);
    }
    let mut pairs = Vec::with_capacity(n);
    for pair in bytes[4..].chunks_exact(2) {
        pairs.push((pair[0], pair[1]));
    }
    CanonicalRule::from_wire(bytes[2], &pairs)
}
