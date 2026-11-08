//! g1 atom IDs follow the catalog order in design source section 1.2.
use crate::{play::Play, words::WORDS};
use alloc::{format, string::String, vec::Vec};

/// Valid daily-tier predicate ID. IDs 90..=95 are reserved for non-daily atoms.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Atom(u8);
impl Atom {
    /// Resolve a daily-tier ID; returns `None` outside the daily tier.
    pub const fn new(id: u8) -> Option<Self> {
        if id < DAILY_ATOMS {
            Some(Self(id))
        } else {
            None
        }
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

/// Number of daily-tier atoms (IDs `0..DAILY_ATOMS`).
pub const DAILY_ATOMS: u8 = 90;

/// Plain-language text for one daily atom. This is the single source of atom meaning for people;
/// it never changes evaluation. "Your last YES" is the entity's last accepted play this round.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AtomText {
    /// English when the literal is positive.
    pub english: String,
    /// English when the literal is negated.
    pub negated: String,
    /// Compact DSL for the positive literal.
    pub dsl: String,
}

fn text(
    english: impl Into<String>,
    negated: impl Into<String>,
    dsl: impl Into<String>,
) -> AtomText {
    AtomText {
        english: english.into(),
        negated: negated.into(),
        dsl: dsl.into(),
    }
}

/// Describe one daily atom, matching [`Atom::evaluate`] exactly.
pub fn describe_atom(atom: Atom) -> AtomText {
    let id = atom.id();
    match id {
        0 => text("the number is even", "the number is odd", "even(n)"),
        1..=19 => {
            let (divisor, base) = match id {
                1..=3 => (3, 1),
                4..=7 => (4, 4),
                8..=12 => (5, 8),
                _ => (7, 13),
            };
            let r = id - base;
            text(
                format!("the number leaves remainder {r} when divided by {divisor}"),
                format!("the number does not leave remainder {r} when divided by {divisor}"),
                format!("n % {divisor} = {r}"),
            )
        }
        20..=28 => {
            let bound = u16::from(id - 19) * 100;
            text(
                format!("the number is below {bound}"),
                format!("the number is {bound} or more"),
                format!("n < {bound}"),
            )
        }
        29..=38 => {
            let d = id - 29;
            text(
                format!("one of its three digits is {d}"),
                format!("none of its three digits is {d}"),
                format!("has_digit(n, {d})"),
            )
        }
        39 => text(
            "the digit sum is even",
            "the digit sum is odd",
            "even(digit_sum(n))",
        ),
        40..=42 => {
            let r = id - 40;
            text(
                format!("the digit sum leaves remainder {r} when divided by 3"),
                format!("the digit sum does not leave remainder {r} when divided by 3"),
                format!("digit_sum(n) % 3 = {r}"),
            )
        }
        43 => text(
            "all three digits are odd",
            "not all three digits are odd",
            "all_odd(digits(n))",
        ),
        44 => text(
            "all three digits are even",
            "not all three digits are even",
            "all_even(digits(n))",
        ),
        45 => text(
            "the three digits strictly increase",
            "the three digits do not strictly increase",
            "increasing(digits(n))",
        ),
        46 => text(
            "the three digits strictly decrease",
            "the three digits do not strictly decrease",
            "decreasing(digits(n))",
        ),
        47 => text(
            "the first and last digits match",
            "the first and last digits differ",
            "first_digit(n) = last_digit(n)",
        ),
        48 => text(
            "at least two digits match",
            "all three digits are different",
            "repeated_digit(n)",
        ),
        49..=56 | 79..=82 | 87..=89 => {
            let (positive, negative, dsl) = match id {
                49 => (
                    "the number is higher than your last YES number",
                    "the number is not higher than your last YES number",
                    "n > prev.n",
                ),
                50 => (
                    "the number is lower than your last YES number",
                    "the number is not lower than your last YES number",
                    "n < prev.n",
                ),
                51 => (
                    "the number repeats your last YES number",
                    "the number differs from your last YES number",
                    "n = prev.n",
                ),
                52 => (
                    "the number has the same parity as your last YES number",
                    "the number has the opposite parity to your last YES number",
                    "parity(n) = parity(prev.n)",
                ),
                53 => (
                    "the digit sum has the same parity as your last YES digit sum",
                    "the digit sum has the opposite parity to your last YES digit sum",
                    "parity(digit_sum(n)) = parity(digit_sum(prev.n))",
                ),
                54 => (
                    "the number is within 99 of your last YES number",
                    "the number is at least 100 away from your last YES number",
                    "abs(n - prev.n) < 100",
                ),
                55 => (
                    "the number ends in the same digit as your last YES number",
                    "the number ends in a different digit from your last YES number",
                    "last_digit(n) = last_digit(prev.n)",
                ),
                56 => (
                    "the number shares a digit with your last YES number",
                    "the number shares no digit with your last YES number",
                    "shares_digit(n, prev.n)",
                ),
                79 => (
                    "the word is in the same group as your last YES word",
                    "the word is in a different group from your last YES word",
                    "group(word) = group(prev.word)",
                ),
                80 => (
                    "the word starts with the same letter as your last YES word",
                    "the word starts with a different letter from your last YES word",
                    "first(word) = first(prev.word)",
                ),
                81 => (
                    "the word is longer than your last YES word",
                    "the word is not longer than your last YES word",
                    "len(word) > len(prev.word)",
                ),
                82 => (
                    "the word is as long as your last YES word",
                    "the word's length differs from your last YES word",
                    "len(word) = len(prev.word)",
                ),
                87 => (
                    "your last YES was under a minute ago",
                    "your last YES was a minute or more ago",
                    "gap < 1m",
                ),
                88 => (
                    "your last YES was between a minute and an hour ago",
                    "your last YES was not between a minute and an hour ago",
                    "1m <= gap < 1h",
                ),
                _ => (
                    "your last YES was between an hour and a day ago",
                    "your last YES was not between an hour and a day ago",
                    "1h <= gap < 24h",
                ),
            };
            text(
                format!("you have a YES this round and {positive}"),
                format!("you have no YES this round, or {negative}"),
                format!("has_prev AND ({dsl})"),
            )
        }
        57..=72 => {
            let group = crate::words::CATEGORIES[usize::from(id - 57)];
            text(
                format!("the word is in the {group} group"),
                format!("the word is not in the {group} group"),
                format!("group(word) = {group}"),
            )
        }
        73..=76 => {
            let len = id - 69;
            text(
                format!("the word has at least {len} letters"),
                format!("the word has fewer than {len} letters"),
                format!("len(word) >= {len}"),
            )
        }
        77 => text(
            "the word starts with a letter from a to m",
            "the word starts with a letter from n to z",
            "first(word) <= m",
        ),
        78 => text(
            "the word starts with a vowel",
            "the word starts with a consonant",
            "vowel(first(word))",
        ),
        83..=85 => {
            let bound = [3, 5, 7][usize::from(id - 83)];
            text(
                format!("the play lands in a minute ending in 0 to {}", bound - 1),
                format!("the play lands in a minute ending in {bound} to 9"),
                format!("minute_digit < {bound}"),
            )
        }
        86 => text(
            "the play lands in a minute ending in an even digit",
            "the play lands in a minute ending in an odd digit",
            "even(minute_digit)",
        ),
        _ => unreachable!("Atom::new admits only daily IDs"),
    }
}

/// Describe a canonical rule as (English, DSL) without changing its semantics.
pub fn describe_rule(rule: &crate::CanonicalRule) -> (String, String) {
    let parts: Vec<(String, String)> = rule
        .literals()
        .iter()
        .map(|literal| {
            let atom = describe_atom(literal.atom);
            if literal.negated {
                (atom.negated, format!("NOT ({})", atom.dsl))
            } else {
                (atom.english, atom.dsl)
            }
        })
        .collect();
    let join = match rule.form() {
        crate::Form::Single => return parts[0].clone(),
        crate::Form::And => ("and", "AND"),
        crate::Form::Or => ("or", "OR"),
    };
    (
        format!("{}, {} {}", parts[0].0, join.0, parts[1].0),
        format!("({}) {} ({})", parts[0].1, join.1, parts[1].1),
    )
}

#[cfg(test)]
mod description_tests {
    use super::*;
    use crate::{Play, eval};
    use std::collections::HashSet;

    #[test]
    fn every_atom_has_unique_positive_negated_and_dsl_text() {
        let mut seen = HashSet::new();
        for id in 0..DAILY_ATOMS {
            let atom = describe_atom(Atom::new(id).unwrap());
            assert_ne!(atom.english, atom.negated, "atom {id}");
            for part in [atom.english, atom.negated, atom.dsl] {
                assert!(
                    !part.is_empty() && seen.insert(part.clone()),
                    "atom {id}: {part}"
                );
            }
        }
        assert!(Atom::new(DAILY_ATOMS).is_none());
    }

    #[test]
    fn revealed_rule_descriptions_match_evaluation() {
        let solo: crate::CanonicalRule =
            serde_json::from_str(r#"{"v":"g1","form":0,"lits":[[22,1]]}"#).unwrap();
        let team: crate::CanonicalRule =
            serde_json::from_str(r#"{"v":"g1","form":2,"lits":[[7,1],[83,0]]}"#).unwrap();
        assert_eq!(
            describe_rule(&solo),
            ("the number is 300 or more".into(), "NOT (n < 300)".into())
        );
        assert_eq!(
            describe_rule(&team).0,
            "the number does not leave remainder 3 when divided by 4, or the play lands in a minute ending in 0 to 2"
        );
        for number in [0, 3, 299, 300, 303, 999] {
            for minute in [0, 2, 3, 9] {
                let play = Play::new(number, 0, minute, None).unwrap();
                assert_eq!(eval(&solo, &play), number >= 300);
                assert_eq!(eval(&team, &play), number % 4 != 3 || minute < 3);
            }
        }
    }
}
