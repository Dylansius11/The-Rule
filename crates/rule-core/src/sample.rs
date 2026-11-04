//! Deterministic daily-rule sampling. Changing any detail changes the g1 rule stream.
//!
//! The fairness population has 4,096 plays. A separate xorshift64* stream starts at
//! `0x7468_652d_7275_6c65`; each play draws, in order, number (0..1000), word
//! (0..128), minute (0..10), previous number (0..1000), previous word (0..128),
//! and gap (0..3), using rejection-bounded draws. Every fifth play (indices
//! divisible by 5) has no previous play; its unused previous fields are still
//! drawn. All other plays have the drawn previous fields. Xorshift64* uses shifts
//! right 12, left 25, right 27 and output multiplier 0x2545_f491_4f6c_dd1d,
//! with wrapping arithmetic. This fixed synthetic population is not a claim about
//! actual player behavior.
use crate::{Atom, CanonicalRule, Form, Literal, Play, Previous};
use alloc::{vec, vec::Vec};
use sha2::{Digest, Sha256};

const POPULATION: usize = 4096;
const MAX_ATTEMPTS: usize = 1024;

/// SHA-256 counter-mode stream: key = SHA256(b"the-rule/drbg/v1" || seed),
/// block i = SHA256(key || i as u32 big-endian), beginning at i=0; each block
/// is consumed as four consecutive little-endian u64 words. The counter wraps
/// after 2^32 blocks. This is a deterministic stream, not an entropy source.
pub struct Drbg {
    key: [u8; 32],
    block: [u8; 32],
    counter: u32,
    offset: usize,
}
impl Drbg {
    /// Initialize from the complete caller-supplied seed bytes.
    pub fn new(seed: &[u8]) -> Self {
        let mut hash = Sha256::new();
        hash.update(b"the-rule/drbg/v1");
        hash.update(seed);
        Self {
            key: hash.finalize().into(),
            block: [0; 32],
            counter: 0,
            offset: 32,
        }
    }
    /// Read the next word in stream order.
    pub fn next_u64(&mut self) -> u64 {
        if self.offset == 32 {
            let mut hash = Sha256::new();
            hash.update(self.key);
            hash.update(self.counter.to_be_bytes());
            self.block = hash.finalize().into();
            self.counter = self.counter.wrapping_add(1);
            self.offset = 0;
        }
        let mut bytes = [0; 8];
        bytes.copy_from_slice(&self.block[self.offset..self.offset + 8]);
        self.offset += 8;
        u64::from_le_bytes(bytes)
    }
    /// Uniform integer in `0..upper`, conditional on success. Discards values
    /// below `2^64 mod upper` before taking the remainder. Returns `None` for
    /// zero or after 128 rejected words, so callers can terminate even for an
    /// adversarial stream. The sampler falls back on `None`.
    pub fn bounded(&mut self, upper: u64) -> Option<u64> {
        if upper == 0 {
            return None;
        }
        let threshold = upper.wrapping_neg() % upper;
        for _ in 0..128 {
            let value = self.next_u64();
            if value >= threshold {
                return Some(value % upper);
            }
        }
        None
    }
}

/// Coarse overall acceptance band; boundaries 30% and 55% belong to the
/// higher band, so every valid acceptance count has exactly one bucket.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Bucket {
    Rare,
    Mid,
    Common,
}

struct FixedStream(u64);
impl FixedStream {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn bounded(&mut self, upper: u64) -> u64 {
        let threshold = upper.wrapping_neg() % upper;
        loop {
            let x = self.next();
            if x >= threshold {
                return x % upper;
            }
        }
    }
}
fn population() -> Vec<Play> {
    let mut stream = FixedStream(0x7468_652d_7275_6c65);
    let mut plays = Vec::with_capacity(POPULATION);
    for i in 0..POPULATION {
        let number = stream.bounded(1000) as u16;
        let word = stream.bounded(128) as u8;
        let minute = stream.bounded(10) as u8;
        let prev = Previous {
            number: stream.bounded(1000) as u16,
            word_id: stream.bounded(128) as u8,
            gap_bucket: stream.bounded(3) as u8,
        };
        plays.push(
            Play::new(
                number,
                word,
                minute,
                if i % 5 == 0 { None } else { Some(prev) },
            )
            .expect("fixed population fields are in range"),
        );
    }
    plays
}
fn band(count: usize, total: usize) -> bool {
    count * 100 >= total * 15 && count * 100 <= total * 85
}
fn fair(rule: &CanonicalRule, plays: &[Play]) -> Option<Bucket> {
    let lits = rule.literals();
    let mut accepted = 0usize;
    let mut first_accepted = 0usize;
    let mut first = 0usize;
    let mut effect = [0usize; 2];
    for play in plays {
        let a = lits[0].atom.evaluate(play) ^ lits[0].negated;
        let b = lits
            .get(1)
            .is_some_and(|l| l.atom.evaluate(play) ^ l.negated);
        let verdict = match rule.form() {
            Form::Single => a,
            Form::And => a & b,
            Form::Or => a | b,
        };
        accepted += usize::from(verdict);
        if play.previous().is_none() {
            first += 1;
            first_accepted += usize::from(verdict);
        }
        if lits.len() == 2 {
            effect[0] += usize::from(verdict != b);
            effect[1] += usize::from(verdict != a);
        }
    }
    if !band(accepted, plays.len())
        || !band(first_accepted, first)
        || (lits.len() == 2
            && (effect[0] * 100 <= 2 * plays.len() || effect[1] * 100 <= 2 * plays.len()))
    {
        return None;
    }
    Some(if accepted * 100 < plays.len() * 30 {
        Bucket::Rare
    } else if accepted * 100 < plays.len() * 55 {
        Bucket::Mid
    } else {
        Bucket::Common
    })
}

/// Classify a canonical rule using the sampler's fixed population and fairness
/// constraints. Returns `None` for unfair rules, including tautologies,
/// contradictions and redundant literals. Canonical construction already
/// rejects duplicate atoms, including an atom paired with its own negation.
pub fn classify(rule: &CanonicalRule) -> Option<Bucket> {
    fair(rule, &population())
}
fn literal(drbg: &mut Drbg) -> Option<Literal> {
    Some(Literal {
        atom: Atom::new(drbg.bounded(90)? as u8)?,
        negated: drbg.bounded(2)? != 0,
    })
}

/// Sample a daily rule. The referee passes `k || b"rule"`, as specified by
/// SMART-CONTRACT; no additional domain bytes are appended by this function.
/// Draw a form uniformly (single, AND, OR), then one or two independently
/// uniform atom IDs and negation bits, in that order. Duplicate atoms are
/// rejected. Sort literals by their existing canonical ordering. Redraw if the
/// overall or no-previous slice acceptance is outside inclusive [15%, 85%],
/// or removing either literal of a two-literal rule changes at most 2% of all
/// plays. A single literal is necessary because flipping it changes every play.
/// After 1,024 rejected candidates, or if a bounded draw exhausts its 128-word
/// limit, the fixed fallback is atom 0 (even number), unnegated; its bucket is
/// computed against the same population. The fallback is independent of seed.
pub fn sample(seed: &[u8]) -> (CanonicalRule, Bucket) {
    let (rule, bucket, _) = sample_with_attempts(seed);
    (rule, bucket)
}

/// As [`sample`], additionally returning the number of candidates attempted.
/// A count of 1,024 can indicate fallback; this diagnostic is deterministic.
#[doc(hidden)]
pub fn sample_with_attempts(seed: &[u8]) -> (CanonicalRule, Bucket, usize) {
    let plays = population();
    let mut drbg = Drbg::new(seed);
    for attempt in 1..=MAX_ATTEMPTS {
        let Some(form_draw) = drbg.bounded(3) else {
            break;
        };
        let form = match form_draw {
            0 => Form::Single,
            1 => Form::And,
            _ => Form::Or,
        };
        let Some(first) = literal(&mut drbg) else {
            break;
        };
        let mut lits = vec![first];
        if form != Form::Single {
            let Some(second) = literal(&mut drbg) else {
                break;
            };
            lits.push(second);
            lits.sort_unstable();
        }
        if let Ok(rule) = CanonicalRule::new(form, lits)
            && let Some(bucket) = fair(&rule, &plays)
        {
            return (rule, bucket, attempt);
        }
    }
    let rule = CanonicalRule::new(
        Form::Single,
        vec![Literal {
            atom: Atom::new(0).expect("daily atom"),
            negated: false,
        }],
    )
    .expect("fixed fallback is canonical");
    let bucket = fair(&rule, &plays).expect("fixed fallback meets fairness constraints");
    (rule, bucket, MAX_ATTEMPTS)
}
