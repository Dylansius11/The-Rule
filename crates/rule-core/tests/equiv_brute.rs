use proptest::prelude::*;
use rule_core::{Atom, CanonicalRule, Form, Literal, Play, Previous, equiv, eval};

fn lit(id: u8, negated: bool) -> Literal {
    Literal {
        atom: Atom::new(id).unwrap(),
        negated,
    }
}
fn single(id: u8, neg: bool) -> CanonicalRule {
    CanonicalRule::new(Form::Single, vec![lit(id, neg)]).unwrap()
}
fn pair(form: Form, a: Literal, b: Literal) -> CanonicalRule {
    let mut v = vec![a, b];
    v.sort();
    CanonicalRule::new(form, v).unwrap()
}
fn next(s: &mut u64) -> u64 {
    *s ^= *s << 13;
    *s ^= *s >> 7;
    *s ^= *s << 17;
    *s
}
fn random_rule(s: &mut u64) -> CanonicalRule {
    let a = (next(s) % 90) as u8;
    let neg = next(s) & 1 != 0;
    if next(s).is_multiple_of(3) {
        return single(a, neg);
    }
    let mut b = (next(s) % 89) as u8;
    if b >= a {
        b += 1;
    }
    pair(
        if next(s) & 1 == 0 {
            Form::And
        } else {
            Form::Or
        },
        lit(a, neg),
        lit(b, next(s) & 1 != 0),
    )
}

// Independent exhaustive oracle: one bit per concrete play, not per signature.
fn oracle() -> (Vec<Vec<u64>>, usize) {
    let count: usize = 15 * 10 * 10 + 15 * 15 * 10 * 10 * 10 * 3;
    let mut bits = vec![vec![0u64; count.div_ceil(64)]; 90];
    let mut index = 0;
    for flag in [false, true] {
        for n in 0..15 {
            for w in 0..10 {
                for minute in 0..10 {
                    for pn in 0..if flag { 15 } else { 1 } {
                        for pw in 0..if flag { 10 } else { 1 } {
                            for gap in 0..if flag { 3 } else { 1 } {
                                let p = Play::new(
                                    n,
                                    w,
                                    minute,
                                    flag.then_some(Previous {
                                        number: pn,
                                        word_id: pw,
                                        gap_bucket: gap,
                                    }),
                                )
                                .unwrap();
                                for id in 0..90 {
                                    if Atom::new(id).unwrap().evaluate(&p) {
                                        bits[id as usize][index / 64] |= 1 << (index % 64);
                                    }
                                }
                                index += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    assert_eq!(index, count);
    (bits, count)
}
fn oracle_word(rule: &CanonicalRule, bits: &[Vec<u64>], word: usize) -> u64 {
    let value = |i: usize| {
        let l = rule.literals()[i];
        let x = bits[l.atom.id() as usize][word];
        if l.negated { !x } else { x }
    };
    match rule.form() {
        Form::Single => value(0),
        Form::And => value(0) & value(1),
        Form::Or => value(0) | value(1),
    }
}
fn brute(a: &CanonicalRule, b: &CanonicalRule, bits: &[Vec<u64>], count: usize) -> bool {
    (0..count.div_ceil(64)).all(|i| {
        let mask = if i == count / 64 && !count.is_multiple_of(64) {
            (1u64 << (count % 64)) - 1
        } else {
            u64::MAX
        };
        (oracle_word(a, bits, i) ^ oracle_word(b, bits, i)) & mask == 0
    })
}

#[test]
fn differential_100000() {
    let (bits, count) = oracle();
    let mut seed = 0x719acde384f213u64;
    let mut equal = 0;
    let mut unequal = 0;
    for i in 0..100_000 {
        let (a, b) = match i % 4 {
            0 => {
                let a = random_rule(&mut seed);
                let b = if a.literals().len() == 2 {
                    pair(a.form(), a.literals()[1], a.literals()[0])
                } else {
                    a.clone()
                };
                (a, b)
            }
            1 => {
                // NOT (NOT r1 AND NOT r2) = r1 OR r2 = NOT r0.
                let r = (next(&mut seed) % 3) as u8;
                let x = (r + 1) % 3;
                let y = (r + 2) % 3;
                (
                    single(1 + r, true),
                    pair(Form::Or, lit(1 + x, false), lit(1 + y, false)),
                )
            }
            2 => {
                let neg = next(&mut seed) & 1 != 0;
                (
                    pair(Form::And, lit(0, neg), lit(83, false)),
                    pair(Form::And, lit(0, neg), lit(84, false)),
                )
            }
            _ => (random_rule(&mut seed), random_rule(&mut seed)),
        };
        let x = equiv::compare(&a, &b, 15, 10).equivalent;
        let y = brute(&a, &b, &bits, count);
        assert_eq!(x, y, "pair {i}: {a:?} {b:?}");
        if x {
            equal += 1;
        } else {
            unequal += 1;
        }
    }
    println!(
        "differential pairs=100000 mismatches=0 equal={equal} unequal={unequal} plays={count}"
    );
    assert!(equal >= 20_000 && unequal >= 20_000);
}

#[test]
fn identities_and_near_miss() {
    let a = lit(0, false);
    let b = lit(83, false);
    assert_eq!(pair(Form::And, a, b), pair(Form::And, b, a));
    assert!(equiv::equivalent(
        &pair(Form::And, a, b),
        &pair(Form::And, b, a)
    ));
    assert!(!equiv::equivalent(
        &pair(Form::And, a, b),
        &pair(Form::And, a, lit(84, false))
    ));
    let and = pair(Form::And, a, b);
    let de_morgan = pair(Form::Or, lit(0, true), lit(83, true));
    for n in 0..1000 {
        for minute in 0..10 {
            let play = Play::new(n, 0, minute, None).unwrap();
            assert_eq!(!eval(&and, &play), eval(&de_morgan, &play));
        }
    }
}

#[test]
fn realizability_and_group_isolation() {
    for w in 0..128 {
        for pw in 0..128 {
            assert!(
                Play::new(
                    0,
                    w,
                    0,
                    Some(Previous {
                        number: 0,
                        word_id: pw,
                        gap_bucket: 0
                    })
                )
                .is_ok()
            );
        }
    }
    for m in 0..10 {
        for gap in 0..3 {
            assert!(
                Play::new(
                    0,
                    0,
                    m,
                    Some(Previous {
                        number: 0,
                        word_id: 0,
                        gap_bucket: gap
                    })
                )
                .is_ok()
            );
        }
    }
    for id in 0..90 {
        for flag in [false, true] {
            for v in 0..128u16 {
                let prev = |n, w, g| {
                    flag.then_some(Previous {
                        number: n,
                        word_id: w,
                        gap_bucket: g,
                    })
                };
                let a = Play::new(7, 3, 2, prev(8, 4, 1)).unwrap();
                let b = match id {
                    0..=56 => Play::new(
                        7,
                        v as u8,
                        (v % 10) as u8,
                        prev(8, (v % 128) as u8, (v % 3) as u8),
                    ),
                    57..=82 => Play::new(v, 3, (v % 10) as u8, prev(999 - v, 4, (v % 3) as u8)),
                    _ => Play::new(v, (v % 128) as u8, 2, prev(999 - v, (v % 128) as u8, 1)),
                }
                .unwrap();
                let atom = Atom::new(id).unwrap();
                assert_eq!(
                    atom.evaluate(&a),
                    atom.evaluate(&b),
                    "atom={id} flag={flag} v={v}"
                );
            }
        }
    }
    let r = equiv::equivalence(
        &pair(Form::And, lit(0, false), lit(57, false)),
        &pair(Form::Or, lit(83, false), lit(87, false)),
    );
    println!(
        "reachable cells no_previous={} previous={}",
        r.cells[0], r.cells[1]
    );
    assert!(r.cells[0] > 0 && r.cells[1] > 0);
}

fn strategy() -> impl Strategy<Value = CanonicalRule> {
    (0u8..90, any::<bool>(), 0u8..89, any::<bool>(), 0u8..3).prop_map(|(a, na, mut b, nb, form)| {
        if form == 0 {
            single(a, na)
        } else {
            if b >= a {
                b += 1;
            }
            pair(
                if form == 1 { Form::And } else { Form::Or },
                lit(a, na),
                lit(b, nb),
            )
        }
    })
}
proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]
    #[test]
    fn equivalence_properties(a in strategy(), b in strategy(), n in 0u16..1000, w in 0u8..128, m in 0u8..10, pn in 0u16..1000, pw in 0u8..128, gap in 0u8..3, flag in any::<bool>()) {
        prop_assert!(equiv::equivalent(&a,&a));
        let ab = equiv::equivalent(&a,&b);
        prop_assert_eq!(ab,equiv::equivalent(&b,&a));
        let p = Play::new(n,w,m,flag.then_some(Previous {number:pn,word_id:pw,gap_bucket:gap})).unwrap();
        if ab { prop_assert_eq!(eval(&a,&p),eval(&b,&p)); }
    }
}

#[test]
#[ignore]
fn full_domain_1000() {
    let mut seed = 0x7123ab8ff154u64;
    let mut max = std::time::Duration::ZERO;
    let start = std::time::Instant::now();
    for _ in 0..1000 {
        let a = random_rule(&mut seed);
        let b = random_rule(&mut seed);
        let now = std::time::Instant::now();
        std::hint::black_box(equiv::equivalent(&a, &b));
        let elapsed = now.elapsed();
        max = max.max(elapsed);
        assert!(
            elapsed < std::time::Duration::from_secs(10),
            "pair exceeded 10 seconds: {elapsed:?}"
        );
    }
    println!(
        "full-domain pairs=1000 max={max:?} total={:?}",
        start.elapsed()
    );
}
