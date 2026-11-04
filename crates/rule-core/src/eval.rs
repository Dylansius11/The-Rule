//! Total evaluation on validated plays and rules.
use crate::{CanonicalRule, Form, Play};

/// Evaluate both literal slots regardless of the rule form or first result.
/// This avoids structure-dependent short-circuiting; it is not a constant-time claim.
pub fn eval(rule: &CanonicalRule, play: &Play) -> bool {
    let lits = rule.literals();
    let a = lits[0].atom.evaluate(play) ^ lits[0].negated;
    let second = lits.get(1).unwrap_or(&lits[0]);
    let b = second.atom.evaluate(play) ^ second.negated;
    match rule.form() {
        Form::Single => a,
        Form::And => a & b,
        Form::Or => a | b,
    }
}
