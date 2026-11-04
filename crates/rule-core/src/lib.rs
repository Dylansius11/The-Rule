//! Pure, deterministic grammar g1 shared by every execution target.
#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

#[cfg(test)]
extern crate std;
pub mod atoms;
pub mod canonical;
pub mod eval;
pub mod play;
pub mod rule;
#[cfg(test)]
mod tests;
pub mod words;

pub use atoms::Atom;
pub use eval::eval;
pub use play::{Play, PlayError, PlayKey, Previous};
pub use rule::{CanonicalRule, Form, Literal, RuleError};
