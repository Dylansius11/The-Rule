use crate::{
    Atom, CanonicalRule, Form, Literal, Play, Previous, RuleError, canonical, eval, words,
};
use alloc::{vec, vec::Vec};
use proptest::prelude::*;
use std::collections::HashMap;

#[test]
fn every_word_round_trips_and_normalizes() {
    for (id, word) in words::WORDS.iter().enumerate() {
        assert_eq!(words::normalize(word), Some(id as u8));
        assert_eq!(words::word(id as u8), Some(*word));
    }
    assert_eq!(words::normalize(" Otter "), Some(0));
    assert_eq!(words::normalize("otters"), None);
    assert_eq!(words::normalize("öttér"), None);
}
#[test]
fn play_rejects_out_of_range_fields() {
    assert!(Play::new(1000, 0, 0, None).is_err());
    assert!(Play::new(0, 128, 0, None).is_err());
    assert!(Play::new(0, 0, 10, None).is_err());
    assert!(
        Play::new(
            0,
            0,
            0,
            Some(Previous {
                number: 1000,
                word_id: 0,
                gap_bucket: 0
            })
        )
        .is_err()
    );
    assert!(
        Play::new(
            0,
            0,
            0,
            Some(Previous {
                number: 0,
                word_id: 128,
                gap_bucket: 0
            })
        )
        .is_err()
    );
    assert!(
        Play::new(
            0,
            0,
            0,
            Some(Previous {
                number: 0,
                word_id: 0,
                gap_bucket: 3
            })
        )
        .is_err()
    );
}
#[test]
fn play_key_injective_million_sample() {
    let mut seen = HashMap::with_capacity(1_000_000);
    for i in 0u32..1_000_000 {
        let prev = if i % 2 == 0 {
            None
        } else {
            Some(Previous {
                number: ((i * 7) % 1000) as u16,
                word_id: ((i * 11) % 128) as u8,
                gap_bucket: (i % 3) as u8,
            })
        };
        let play = Play::new(
            (i % 1000) as u16,
            ((i / 1000) % 128) as u8,
            (i / 128000) as u8,
            prev,
        )
        .unwrap();
        assert!(seen.insert(play.play_key().0, play).is_none());
    }
}
proptest! {
    #[test]
    fn canonical_roundtrip(id in 0u8..90, neg in any::<bool>(), id2 in 0u8..89, neg2 in any::<bool>(), binary in any::<bool>(), or in any::<bool>()) {
        let a = Literal { atom: Atom::new(id).unwrap(), negated: neg };
        let b = Literal { atom: Atom::new(if id2 >= id {id2+1} else {id2}).unwrap(), negated: neg2 };
        let mut lits = if binary { vec![a,b] } else { vec![a] }; lits.sort();
        let rule = CanonicalRule::new(if !binary { Form::Single } else if or { Form::Or } else { Form::And }, lits).unwrap();
        prop_assert_eq!(canonical::decode(&canonical::encode(&rule)).unwrap(), rule);
    }
}
#[test]
fn reject_noncanonical_rules() {
    assert_eq!(
        canonical::decode(b"g1\x01\x02\x02\x00\x01\x00"),
        Err(RuleError::Unsorted)
    );
    assert_eq!(
        canonical::decode(b"g1\x01\x02\x01\x00\x01\x01"),
        Err(RuleError::Duplicate)
    );
    assert_eq!(
        canonical::decode(b"g1\x00\x01\xff\x00"),
        Err(RuleError::UnknownAtom)
    );
    assert_eq!(
        canonical::decode(b"g1\x00\x01\x5a\x00"),
        Err(RuleError::OverTier)
    );
    assert_eq!(
        canonical::decode(b"g1\x00\x01\x00\x02"),
        Err(RuleError::Negation)
    );
    assert_eq!(
        canonical::decode(b"g1\x00\x01\x00\x00\x00"),
        Err(RuleError::Length)
    );
}
#[test]
fn golden_rules() {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/vectors/rule.json")).unwrap();
    for row in rows.as_array().unwrap() {
        let rule: CanonicalRule = serde_json::from_value(row["rule"].clone()).unwrap();
        assert_eq!(serde_json::to_value(&rule).unwrap(), row["rule"]);
        let bytes: Vec<u8> = serde_json::from_value(row["bytes"].clone()).unwrap();
        assert_eq!(canonical::encode(&rule), bytes);
        assert_eq!(canonical::decode(&bytes).unwrap(), rule);
    }
}
#[test]
fn eval_truth_examples() {
    let p = Play::new(124, 0, 4, None).unwrap();
    let lit = |id, negated| Literal {
        atom: Atom::new(id).unwrap(),
        negated,
    };
    assert!(eval(
        &CanonicalRule::new(Form::Single, vec![lit(0, false)]).unwrap(),
        &p
    ));
    assert!(!eval(
        &CanonicalRule::new(Form::And, vec![lit(0, false), lit(49, false)]).unwrap(),
        &p
    ));
    assert!(eval(
        &CanonicalRule::new(Form::Or, vec![lit(0, false), lit(49, false)]).unwrap(),
        &p
    ));
}

#[test]
fn atom_catalog_truth_table() {
    let p = Play::new(
        124,
        0,
        4,
        Some(Previous {
            number: 100,
            word_id: 1,
            gap_bucket: 1,
        }),
    )
    .unwrap();
    let expected_true = [
        0, 2, 4, 12, 18, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 33, 41, 45, 49, 52, 53, 54, 56,
        57, 73, 74, 78, 79, 81, 84, 85, 86, 88,
    ];
    for id in 0..90 {
        assert_eq!(
            Atom::new(id).unwrap().evaluate(&p),
            expected_true.contains(&id),
            "atom {id}"
        );
    }
    let first = Play::new(124, 0, 4, None).unwrap();
    for id in (49..=56).chain(79..=82).chain(87..=89) {
        assert!(!Atom::new(id).unwrap().evaluate(&first), "atom {id}");
    }
}
