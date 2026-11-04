use rule_core::{
    Atom, Bucket, CanonicalRule, Form, Literal, Play, Previous, canonical, eval, sample,
    sample::sample_with_attempts,
};
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Serialize, Deserialize)]
struct Vector {
    seed: String,
    rule: String,
    bucket: String,
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}
fn bucket_name(b: Bucket) -> &'static str {
    match b {
        Bucket::Rare => "rare",
        Bucket::Mid => "mid",
        Bucket::Common => "common",
    }
}

// Independent reproduction of the documented fixed population, not sampler internals.
fn population() -> Vec<Play> {
    let mut x = 0x7468_652d_7275_6c65u64;
    let mut draw = |n: u64| loop {
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        let value = x.wrapping_mul(0x2545_f491_4f6c_dd1d);
        if value >= n.wrapping_neg() % n {
            break value % n;
        }
    };
    (0..4096)
        .map(|i| {
            let n = draw(1000) as u16;
            let w = draw(128) as u8;
            let m = draw(10) as u8;
            let p = Previous {
                number: draw(1000) as u16,
                word_id: draw(128) as u8,
                gap_bucket: draw(3) as u8,
            };
            Play::new(n, w, m, (i % 5 != 0).then_some(p)).unwrap()
        })
        .collect()
}
fn check(rule: &CanonicalRule, bucket: Bucket, plays: &[Play]) {
    let verdicts: Vec<bool> = plays.iter().map(|p| eval(rule, p)).collect();
    let count = verdicts.iter().filter(|v| **v).count();
    let first: Vec<bool> = plays
        .iter()
        .zip(&verdicts)
        .filter_map(|(p, v)| p.previous().is_none().then_some(*v))
        .collect();
    let first_count = first.iter().filter(|v| **v).count();
    assert!(count * 100 >= 15 * plays.len() && count * 100 <= 85 * plays.len());
    assert!(first_count * 100 >= 15 * first.len() && first_count * 100 <= 85 * first.len());
    let expected = if count * 100 < 30 * plays.len() {
        Bucket::Rare
    } else if count * 100 < 55 * plays.len() {
        Bucket::Mid
    } else {
        Bucket::Common
    };
    assert_eq!(bucket, expected);
    if rule.literals().len() == 2 {
        assert_ne!(rule.literals()[0].atom, rule.literals()[1].atom);
        for index in 0..2 {
            let other = rule.literals()[1 - index];
            let reduced = CanonicalRule::new(Form::Single, vec![other]).unwrap();
            let changed = plays
                .iter()
                .zip(&verdicts)
                .filter(|(p, v)| eval(&reduced, p) != **v)
                .count();
            assert!(changed * 100 > 2 * plays.len());
            let mut lits = rule.literals().to_vec();
            lits[index].negated = !lits[index].negated;
            let flipped = CanonicalRule::new(rule.form(), lits).unwrap();
            let changed = plays
                .iter()
                .zip(&verdicts)
                .filter(|(p, v)| eval(&flipped, p) != **v)
                .count();
            assert!(changed * 100 > 2 * plays.len());
        }
    } else {
        let lit = rule.literals()[0];
        let flipped = CanonicalRule::new(
            Form::Single,
            vec![Literal {
                atom: lit.atom,
                negated: !lit.negated,
            }],
        )
        .unwrap();
        assert!(
            plays
                .iter()
                .zip(&verdicts)
                .all(|(p, v)| eval(&flipped, p) != *v)
        );
    }
}
#[test]
fn drbg_sha256_counter_reference() {
    let mut rng = rule_core::Drbg::new(b"abc");
    assert_eq!(rng.next_u64(), 4_992_704_252_234_776_739);
    assert_eq!(rng.next_u64(), 9_714_222_103_334_182_939);
    assert_eq!(rng.next_u64(), 15_331_108_952_437_844_421);
    assert_eq!(rng.next_u64(), 4_244_123_769_698_653_868);
    let mut rng = rule_core::Drbg::new(b"abc");
    assert_eq!(rng.bounded(0), None);
    // The first word falls below the rejection threshold; the second is used.
    assert_eq!(
        rng.bounded((1_u64 << 63) + 1),
        Some(490_850_066_479_407_130)
    );
}

#[test]
fn fallback_meets_constraints() {
    let rule = CanonicalRule::new(
        Form::Single,
        vec![Literal {
            atom: Atom::new(0).unwrap(),
            negated: false,
        }],
    )
    .unwrap();
    check(&rule, Bucket::Mid, &population());
}

#[test]
fn classification_accepts_fair_and_rejects_degenerate_rules() {
    let lit = |id, negated| Literal {
        atom: Atom::new(id).unwrap(),
        negated,
    };
    let fair = CanonicalRule::new(Form::Single, vec![lit(0, false)]).unwrap();
    assert_eq!(rule_core::classify(&fair), Some(Bucket::Mid));

    // n < 900 OR n >= 100, and n < 100 AND n >= 900.
    let tautology = CanonicalRule::new(Form::Or, vec![lit(20, true), lit(28, false)]).unwrap();
    let contradiction = CanonicalRule::new(Form::And, vec![lit(20, false), lit(28, true)]).unwrap();
    assert_eq!(rule_core::classify(&tautology), None);
    assert_eq!(rule_core::classify(&contradiction), None);

    // The canonical type cannot represent an atom paired with its negation.
    for form in [Form::And, Form::Or] {
        assert_eq!(
            CanonicalRule::new(form, vec![lit(0, false), lit(0, true)]),
            Err(rule_core::RuleError::Duplicate)
        );
    }
}

#[test]
fn sampled_rules_classify_consistently() {
    for seed in 0u64..1_000 {
        let (rule, bucket) = sample(&seed.to_le_bytes());
        assert_eq!(rule_core::classify(&rule), Some(bucket), "seed {seed}");
    }
}

#[test]
fn vectors_match() {
    let vectors: Vec<Vector> =
        serde_json::from_str(include_str!("../../../tests/vectors/sample.json")).unwrap();
    assert!(vectors.len() >= 64);
    let start = Instant::now();
    let mut max = 0;
    for v in &vectors {
        let now = Instant::now();
        let (rule, bucket) = sample(&unhex(&v.seed));
        max = max.max(now.elapsed().as_micros());
        assert_eq!(hex(&canonical::encode(&rule)), v.rule);
        assert_eq!(bucket_name(bucket), v.bucket);
    }
    println!(
        "vectors={} total_ms={} max_us={} mean_us={} over_500ms={}",
        vectors.len(),
        start.elapsed().as_millis(),
        max,
        start.elapsed().as_micros() / vectors.len() as u128,
        max > 500_000
    );
}
#[test]
fn fairness_and_distribution_10000() {
    let plays = population();
    let mut buckets = [0usize; 3];
    let mut atoms = [0usize; 90];
    let start = Instant::now();
    let mut max = 0;
    for i in 0u64..10_000 {
        let now = Instant::now();
        let (rule, bucket) = sample(&i.to_le_bytes());
        max = max.max(now.elapsed().as_micros());
        check(&rule, bucket, &plays);
        buckets[match bucket {
            Bucket::Rare => 0,
            Bucket::Mid => 1,
            Bucket::Common => 2,
        }] += 1;
        for lit in rule.literals() {
            atoms[lit.atom.id() as usize] += 1;
        }
    }
    println!(
        "fairness=10000 buckets={buckets:?} sample_max_us={max} total_ms={} atom_counts={atoms:?}",
        start.elapsed().as_millis()
    );
    println!(
        "unobserved_atoms={:?}",
        atoms
            .iter()
            .enumerate()
            .filter_map(|(id, n)| (*n == 0).then_some(id))
            .collect::<Vec<_>>()
    );
    assert!(buckets.iter().all(|n| *n > 0));
}
#[test]
#[ignore = "extended rejection-bound measurement"]
fn rejection_bound_100000() {
    let start = Instant::now();
    let mut max = 0;
    let mut max_us = 0;
    for i in 0u64..100_000 {
        let now = Instant::now();
        let (_, _, attempts) = sample_with_attempts(&i.to_le_bytes());
        max_us = max_us.max(now.elapsed().as_micros());
        max = max.max(attempts);
    }
    println!(
        "seeds=100000 max_attempts={max} max_us={max_us} total_ms={}",
        start.elapsed().as_millis()
    );
    assert!(max < 1024);
}
#[test]
#[ignore = "regenerate fixture explicitly"]
fn generate_vectors() {
    let vectors: Vec<_> = (0u64..64)
        .map(|i| {
            let seed = i.to_le_bytes();
            let (rule, bucket) = sample(&seed);
            Vector {
                seed: hex(&seed),
                rule: hex(&canonical::encode(&rule)),
                bucket: bucket_name(bucket).into(),
            }
        })
        .collect();
    let dir = format!("{}/../../scratch/sampler", env!("CARGO_MANIFEST_DIR"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        format!("{dir}/sample.json"),
        serde_json::to_string_pretty(&vectors).unwrap() + "\n",
    )
    .unwrap();
}
#[test]
fn atom_catalog_boundary() {
    assert!(Atom::new(89).is_some());
    assert!(Atom::new(90).is_none());
}

#[test]
fn equality_atom_is_excluded_by_fairness() {
    let plays = population();
    let true_count = plays
        .iter()
        .filter(|p| Atom::new(51).unwrap().evaluate(p))
        .count();
    println!("atom_51_true={true_count}/{}", plays.len());
    // A singleton violates the acceptance band. In either two-literal form,
    // one removal effect is bounded by this rare atom's true count, regardless
    // of its sign, so the strict >2% necessity requirement excludes it.
    assert!(true_count * 100 <= 2 * plays.len());
}
