//! Validated daily rule shapes and strict canonical JSON.
use crate::Atom;
use alloc::vec::Vec;
use serde::{Deserialize, Deserializer, Serialize, Serializer, ser::SerializeStruct};

/// Wire form codes: one literal = 0, AND = 1, OR = 2.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Form {
    Single = 0,
    And = 1,
    Or = 2,
}
/// A predicate and its negation flag.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Literal {
    pub atom: Atom,
    pub negated: bool,
}
/// Strictly ordered, nonduplicate daily-tier rule.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalRule {
    form: Form,
    lits: Vec<Literal>,
}
/// Invalid canonical rule.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuleError {
    Version,
    Form,
    Length,
    Negation,
    UnknownAtom,
    OverTier,
    Unsorted,
    Duplicate,
}
impl CanonicalRule {
    /// Construct a canonical rule. Input must already be sorted and contain distinct atoms.
    pub fn new(form: Form, lits: Vec<Literal>) -> Result<Self, RuleError> {
        if lits.len() != if form == Form::Single { 1 } else { 2 } {
            return Err(RuleError::Length);
        }
        if lits.len() == 2 {
            if lits[0].atom == lits[1].atom {
                return Err(RuleError::Duplicate);
            }
            if lits[0] > lits[1] {
                return Err(RuleError::Unsorted);
            }
        }
        Ok(Self { form, lits })
    }
    /// Rule form.
    pub const fn form(&self) -> Form {
        self.form
    }
    /// Sorted literals, length one or two.
    pub fn literals(&self) -> &[Literal] {
        &self.lits
    }
    pub(crate) fn from_wire(form: u8, pairs: &[(u8, u8)]) -> Result<Self, RuleError> {
        let form = match form {
            0 => Form::Single,
            1 => Form::And,
            2 => Form::Or,
            _ => return Err(RuleError::Form),
        };
        let mut lits = Vec::with_capacity(pairs.len());
        for &(id, neg) in pairs {
            let atom = Atom::new(id).ok_or(if id < 96 {
                RuleError::OverTier
            } else {
                RuleError::UnknownAtom
            })?;
            let negated = match neg {
                0 => false,
                1 => true,
                _ => return Err(RuleError::Negation),
            };
            lits.push(Literal { atom, negated });
        }
        Self::new(form, lits)
    }
}
impl Serialize for CanonicalRule {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut state = s.serialize_struct("CanonicalRule", 3)?;
        state.serialize_field("v", "g1")?;
        state.serialize_field("form", &(self.form as u8))?;
        let pairs: Vec<(u8, u8)> = self
            .lits
            .iter()
            .map(|l| (l.atom.id(), u8::from(l.negated)))
            .collect();
        state.serialize_field("lits", &pairs)?;
        state.end()
    }
}
impl<'de> Deserialize<'de> for CanonicalRule {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            v: alloc::string::String,
            form: u8,
            lits: Vec<(u8, u8)>,
        }
        let w = Wire::deserialize(d)?;
        if w.v != "g1" {
            return Err(serde::de::Error::custom("invalid rule version"));
        }
        Self::from_wire(w.form, &w.lits)
            .map_err(|_| serde::de::Error::custom("invalid canonical rule"))
    }
}
