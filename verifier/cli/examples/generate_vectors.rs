use protocol::{Hex32, round_commitment};
use rule_core::{Play, eval, sample};
use serde_json::json;
use verifier_cli::{Export, Round, Row, verify_export};

fn main() {
    let (rule, _) = sample(b"verifier golden vector");
    let salt = Hex32([42; 32]);
    let commit = round_commitment(&rule, &salt.0);
    let rows = (0..4)
        .map(|i| {
            let play = Play::new(123 + i, i as u8, i as u8, None).unwrap();
            Row {
                log_idx: i as u32,
                seq: [3, 1, 2, 4][i as usize],
                play,
                verdict: eval(&rule, &play),
            }
        })
        .collect();
    let valid = Export {
        round: Round {
            phase: "Settled".into(),
            log_len: 4,
            rule: Some(rule),
            salt: Some(salt),
            commit: Some(commit),
        },
        rows,
    };
    let mut tampered = valid.clone();
    tampered.rows[1].verdict = !tampered.rows[1].verdict;
    let mut duplicate = valid.clone();
    duplicate.rows[2].seq = duplicate.rows[1].seq;
    let mut truncated = valid.clone();
    truncated.rows.pop();
    let cases: Vec<_> = [valid, tampered, duplicate, truncated]
        .into_iter()
        .map(|export| json!({"expected":verify_export(&export),"export":export}))
        .collect();
    println!("{}", serde_json::to_string_pretty(&cases).unwrap());
}
