use rule_core::{Atom, Bucket, CanonicalRule, Form, Literal, classify};

fn main() {
    let mut forms = [0u64; 3];
    let mut buckets = [0u64; 3];
    let mut count = |form: Form, lits: Vec<Literal>| {
        let rule = CanonicalRule::new(form, lits).expect("canonical literals");
        if let Some(bucket) = classify(&rule) {
            forms[form as usize] += 1;
            buckets[match bucket {
                Bucket::Rare => 0,
                Bucket::Mid => 1,
                Bucket::Common => 2,
            }] += 1;
        }
    };
    for a in 0..90 {
        for negated in [false, true] {
            let first = Literal {
                atom: Atom::new(a).unwrap(),
                negated,
            };
            count(Form::Single, vec![first]);
            for b in a + 1..90 {
                for negated in [false, true] {
                    let second = Literal {
                        atom: Atom::new(b).unwrap(),
                        negated,
                    };
                    for form in [Form::And, Form::Or] {
                        count(form, vec![first, second]);
                    }
                }
            }
        }
    }
    println!(
        "{{\"total\":{},\"byForm\":{{\"Single\":{},\"AND\":{},\"OR\":{}}},\"byBucket\":{{\"Rare\":{},\"Mid\":{},\"Common\":{}}}}}",
        forms.iter().sum::<u64>(),
        forms[0],
        forms[1],
        forms[2],
        buckets[0],
        buckets[1],
        buckets[2]
    );
}
