//! g1 atom IDs follow the catalog order in design source section 1.2.
use crate::{play::Play, words::WORDS};

/// Valid daily-tier predicate ID. IDs 90..=95 are reserved for non-daily atoms.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Atom(u8);
impl Atom {
    /// Resolve a daily-tier ID; returns `None` outside the daily tier.
    pub const fn new(id: u8) -> Option<Self> {
        if id < 90 { Some(Self(id)) } else { None }
    }
    /// Wire ID.
    pub const fn id(self) -> u8 {
        self.0
    }
    /// Evaluate this predicate on a validated play. Previous-dependent predicates are false without a previous play.
    pub fn evaluate(self, play: &Play) -> bool {
        let n = play.number();
        let digits = [n / 100, n / 10 % 10, n % 10];
        let sum = digits[0] + digits[1] + digits[2];
        let prev = play.previous();
        let p = prev.map_or(0, |p| p.number);
        let pd = [p / 100, p / 10 % 10, p % 10];
        let word = WORDS[usize::from(play.word_id())];
        let pw = WORDS[usize::from(prev.map_or(0, |p| p.word_id))];
        let id = self.0;
        match id {
            0 => n.is_multiple_of(2),
            1..=3 => n % 3 == u16::from(id - 1),
            4..=7 => n % 4 == u16::from(id - 4),
            8..=12 => n % 5 == u16::from(id - 8),
            13..=19 => n % 7 == u16::from(id - 13),
            20..=28 => n < u16::from(id - 19) * 100,
            29..=38 => digits.contains(&u16::from(id - 29)),
            39 => sum.is_multiple_of(2),
            40..=42 => sum % 3 == u16::from(id - 40),
            43 => digits.iter().all(|d| d % 2 == 1),
            44 => digits.iter().all(|d| d % 2 == 0),
            45 => digits[0] < digits[1] && digits[1] < digits[2],
            46 => digits[0] > digits[1] && digits[1] > digits[2],
            47 => digits[0] == digits[2],
            48 => digits[0] == digits[1] || digits[0] == digits[2] || digits[1] == digits[2],
            49..=56 => {
                prev.is_some()
                    && match id {
                        49 => n > p,
                        50 => n < p,
                        51 => n == p,
                        52 => n % 2 == p % 2,
                        53 => sum % 2 == (pd[0] + pd[1] + pd[2]) % 2,
                        54 => n.abs_diff(p) < 100,
                        55 => n % 10 == p % 10,
                        56 => digits.iter().any(|d| pd.contains(d)),
                        _ => false,
                    }
            }
            57..=72 => play.word_id() / 8 == id - 57,
            73..=76 => word.len() >= usize::from(id - 69),
            77 => word.as_bytes()[0] <= b'm',
            78 => b"aeiou".contains(&word.as_bytes()[0]),
            79..=82 => {
                prev.is_some()
                    && match id {
                        79 => play.word_id() / 8 == prev.map_or(0, |p| p.word_id) / 8,
                        80 => word.as_bytes()[0] == pw.as_bytes()[0],
                        81 => word.len() > pw.len(),
                        82 => word.len() == pw.len(),
                        _ => false,
                    }
            }
            83..=85 => play.minute_digit() < [3, 5, 7][usize::from(id - 83)],
            86 => play.minute_digit().is_multiple_of(2),
            87..=89 => prev.is_some_and(|p| p.gap_bucket == id - 87),
            _ => false,
        }
    }
}
