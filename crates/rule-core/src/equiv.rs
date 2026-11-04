//! Exact equivalence via reachable truth signatures of independent play-field groups.
use crate::{Atom, CanonicalRule, Form, Play, Previous};

/// Result and numbers of reachable truth-signature cells for absent/present previous play.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Equivalence {
    pub equivalent: bool,
    pub cells: [usize; 2],
}

/// Compare on the complete daily-tier domain.
pub fn equivalent(a: &CanonicalRule, b: &CanonicalRule) -> bool {
    compare(a, b, 1000, 128).equivalent
}

/// Compare on the complete domain and report reachable cells for each previous-play flag.
pub fn equivalence(a: &CanonicalRule, b: &CanonicalRule) -> Equivalence {
    compare(a, b, 1000, 128)
}

/// Compare on the prefix domain `0..numbers` and `0..words`; intended for exhaustive oracle tests.
/// Time always covers all ten digits and all three gap buckets.
pub fn compare(a: &CanonicalRule, b: &CanonicalRule, numbers: u16, words: u8) -> Equivalence {
    assert!((1..=1000).contains(&numbers) && (1..=128).contains(&words));
    let mut atoms = [Atom::new(0).unwrap(); 4];
    let mut len = 0;
    for lit in a.literals().iter().chain(b.literals()) {
        if !atoms[..len].contains(&lit.atom) {
            atoms[len] = lit.atom;
            len += 1;
        }
    }
    let atoms = &atoms[..len];
    let mut result = Equivalence {
        equivalent: true,
        cells: [0; 2],
    };
    for flag in [false, true] {
        let mut signatures = [0u16; 3];
        for (group, signatures_for_group) in signatures.iter_mut().enumerate() {
            let mask = atoms.iter().enumerate().fold(0u8, |mask, (i, atom)| {
                mask | if atom_group(*atom) == group {
                    1 << i
                } else {
                    0
                }
            });
            let mut insert = |play: Play| {
                let mut signature = 0u8;
                for (i, atom) in atoms.iter().enumerate() {
                    if mask & (1 << i) != 0 && atom.evaluate(&play) {
                        signature |= 1 << i;
                    }
                }
                *signatures_for_group |= 1 << signature;
            };
            match group {
                0 => {
                    let dependent = atoms.iter().any(|atom| (49..=56).contains(&atom.id()));
                    for n in 0..numbers {
                        for p in 0..if flag && dependent { numbers } else { 1 } {
                            insert(
                                Play::new(
                                    n,
                                    0,
                                    0,
                                    flag.then_some(Previous {
                                        number: p,
                                        word_id: 0,
                                        gap_bucket: 0,
                                    }),
                                )
                                .unwrap(),
                            );
                        }
                    }
                }
                1 => {
                    let dependent = atoms.iter().any(|atom| (79..=82).contains(&atom.id()));
                    for w in 0..words {
                        for p in 0..if flag && dependent { words } else { 1 } {
                            insert(
                                Play::new(
                                    0,
                                    w,
                                    0,
                                    flag.then_some(Previous {
                                        number: 0,
                                        word_id: p,
                                        gap_bucket: 0,
                                    }),
                                )
                                .unwrap(),
                            );
                        }
                    }
                }
                _ => {
                    for minute in 0..10 {
                        for gap in 0..if flag { 3 } else { 1 } {
                            insert(
                                Play::new(
                                    0,
                                    0,
                                    minute,
                                    flag.then_some(Previous {
                                        number: 0,
                                        word_id: 0,
                                        gap_bucket: gap,
                                    }),
                                )
                                .unwrap(),
                            );
                        }
                    }
                }
            }
        }
        for n in 0..16 {
            if signatures[0] & (1 << n) == 0 {
                continue;
            }
            for w in 0..16 {
                if signatures[1] & (1 << w) == 0 {
                    continue;
                }
                for t in 0..16 {
                    if signatures[2] & (1 << t) == 0 {
                        continue;
                    }
                    result.cells[usize::from(flag)] += 1;
                    let bits = n | w | t;
                    result.equivalent &= formula(a, atoms, bits) == formula(b, atoms, bits);
                }
            }
        }
    }
    result
}

fn atom_group(atom: Atom) -> usize {
    match atom.id() {
        0..=56 => 0,
        57..=82 => 1,
        _ => 2,
    }
}

fn formula(rule: &CanonicalRule, atoms: &[Atom], bits: usize) -> bool {
    let value = |index: usize| {
        let lit = rule.literals()[index];
        let pos = atoms.iter().position(|a| *a == lit.atom).unwrap();
        (bits & (1 << pos) != 0) ^ lit.negated
    };
    match rule.form() {
        Form::Single => value(0),
        Form::And => value(0) & value(1),
        Form::Or => value(0) | value(1),
    }
}

#[cfg(test)]
mod tests {
    use crate::{Play, Previous};

    #[test]
    fn time_and_word_pairs_have_witnesses() {
        for minute in 0..10u64 {
            // A day plus the chosen minute leaves room for every allowed gap.
            let now = 86_400 + minute * 60;
            for (gap, elapsed) in [(0, 1), (1, 60), (2, 3_600)] {
                let previous_time = now - elapsed;
                let delta = now - previous_time;
                assert_eq!((now / 60) % 10, minute);
                assert_eq!(
                    if delta < 60 {
                        0
                    } else if delta < 3_600 {
                        1
                    } else {
                        2
                    },
                    gap
                );
                for word in 0..128 {
                    for prev_word in 0..128 {
                        assert!(
                            Play::new(
                                0,
                                word,
                                minute as u8,
                                Some(Previous {
                                    number: 0,
                                    word_id: prev_word,
                                    gap_bucket: gap,
                                })
                            )
                            .is_ok()
                        );
                    }
                }
            }
        }
    }
}
