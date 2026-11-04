use protocol::{Hex32, round_commitment};
use rule_core::{Play, eval, sample};
use std::{
    io::{Read, Write},
    net::TcpListener,
    process::Command,
    time::Instant,
};
use verifier_cli::{Export, Round, Row, Verification, verify_export};

fn round(n: u32) -> Export {
    let (rule, _) = sample(b"verifier test seed");
    let salt = Hex32([7; 32]);
    let commit = round_commitment(&rule, &salt.0);
    let rows = (0..n)
        .map(|i| {
            let play = Play::new(
                (i % 1000) as u16,
                ((i / 1000) % 128) as u8,
                (i % 10) as u8,
                None,
            )
            .unwrap();
            Row {
                log_idx: i,
                seq: i as u64,
                play_key: play.play_key().0.to_string(),
                play,
                verdict: eval(&rule, &play),
            }
        })
        .collect();
    Export {
        round: Round {
            phase: "Settled".into(),
            log_len: n,
            rule: Some(rule),
            salt: Some(salt),
            commit: Some(commit),
        },
        rows,
    }
}
fn reason(export: &Export) -> String {
    match verify_export(export) {
        Verification::Fail { reason } => reason,
        result => panic!("expected failure: {result:?}"),
    }
}

#[test]
fn replay_tampering_and_completeness() {
    let good = round(3);
    assert_eq!(
        verify_export(&good),
        Verification::Pass {
            matched: 3,
            total: 3
        }
    );
    let mut x = good.clone();
    x.rows[1].verdict = !x.rows[1].verdict;
    assert_eq!(
        reason(&x),
        format!(
            "verdict mismatch at index 1: recorded {}, expected {}",
            x.rows[1].verdict, !x.rows[1].verdict
        )
    );
    let mut x = good.clone();
    x.rows[1].play_key.push('0');
    assert_eq!(reason(&x), "PlayKeyMismatch at index 1");
    assert_eq!(
        verifier_cli::consistent(x.round.rule.as_ref().unwrap(), &x.rows),
        Verification::Fail {
            reason: "PlayKeyMismatch at index 1".into()
        }
    );
    let mut x = good.clone();
    x.round.salt = Some(Hex32([8; 32]));
    assert_eq!(reason(&x), "commitment mismatch");
    let mut x = good.clone();
    x.round.commit = Some(Hex32([8; 32]));
    assert_eq!(reason(&x), "commitment mismatch");
    let mut x = good.clone();
    x.round.rule = Some(sample(b"different seed").0);
    assert_eq!(reason(&x), "commitment mismatch");
    let mut x = good.clone();
    x.rows.insert(1, x.rows[0].clone());
    assert_eq!(reason(&x), "duplicate index at position 1: found 0");
    let mut x = good.clone();
    x.rows.swap(0, 1);
    assert_eq!(reason(&x), "reordered index at position 0: found 1");
    let mut x = good.clone();
    x.rows.remove(1);
    assert_eq!(reason(&x), "missing index at position 1: found 2");
    let mut x = good.clone();
    x.rows.pop();
    assert_eq!(reason(&x), "log length mismatch: expected 3, found 2");
    let mut x = good.clone();
    x.rows[0].seq = 3;
    x.rows[1].seq = 1;
    x.rows[2].seq = 2;
    assert_eq!(
        verify_export(&x),
        Verification::Pass {
            matched: 3,
            total: 3
        }
    );
    x.rows[2].seq = 1;
    assert_eq!(reason(&x), "duplicate sequence at index 2: 1");
    for phase in ["Void", "Cancelled", "Opening"] {
        let mut x = good.clone();
        x.round.phase = phase.into();
        assert_eq!(
            reason(&x),
            format!("round is {phase}, not Settled; replay unavailable")
        );
    }
}

#[test]
fn chain_row_accepts_full_and_future_fields_but_validates_inputs() {
    let valid = round(1);
    let mut row = serde_json::to_value(&valid.rows[0]).unwrap();
    row["entity_tag"] = 0.into();
    row["entity_id"] = 42.into();
    row["actor"] = 42.into();
    row["account"] = "alice.testnet".into();
    row["minted"] = "0".into();
    row["future_field"] = serde_json::json!({"any": true});
    let decoded: Row = serde_json::from_value(row.clone()).unwrap();
    assert_eq!(decoded.play_key, valid.rows[0].play_key);
    for (field, value) in [
        ("play_key", serde_json::json!(0)),
        ("seq", serde_json::json!("0")),
        ("log_idx", serde_json::json!(-1)),
        ("verdict", serde_json::json!(1)),
        (
            "play",
            serde_json::json!({"number": 1000, "word_id": 0, "minute_digit": 0, "prev": null}),
        ),
    ] {
        let mut bad = row.clone();
        bad[field] = value;
        assert!(serde_json::from_value::<Row>(bad).is_err(), "{field}");
    }
    for key in ["00", "+0", "", "18446744073709551616"] {
        let mut bad = valid.clone();
        bad.rows[0].play_key = key.into();
        assert_eq!(reason(&bad), "PlayKeyMismatch at index 0");
    }
}

#[test]
fn large_round_under_one_second() {
    let data = round(10_000);
    let start = Instant::now();
    assert_eq!(
        verify_export(&data),
        Verification::Pass {
            matched: 10_000,
            total: 10_000
        }
    );
    assert!(
        start.elapsed().as_secs_f64() < 1.0,
        "took {:?}",
        start.elapsed()
    );
}

#[test]
fn file_cli_and_vectors() {
    let vectors: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../tests/vectors/verify.json")).unwrap();
    for (i, item) in vectors.iter().enumerate() {
        let data: Export = serde_json::from_value(item["export"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(verify_export(&data)).unwrap(),
            item["expected"]
        );
        let path =
            std::env::temp_dir().join(format!("the-rule-verify-{}-{i}.json", std::process::id()));
        std::fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        let result = Command::new(env!("CARGO_BIN_EXE_rule"))
            .args(["verify", "--from-file", path.to_str().unwrap(), "--json"])
            .output()
            .unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&result.stdout).unwrap(),
            item["expected"]
        );
        assert_eq!(
            result.status.success(),
            item["expected"]["status"] == "pass"
        );
    }
}

#[test]
fn json_errors_are_machine_readable() {
    let result = Command::new(env!("CARGO_BIN_EXE_rule"))
        .args(["verify", "--network", "mainnet", "--json"])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&result.stdout).unwrap(),
        serde_json::json!({"status":"fail","reason":"--network must be testnet"})
    );
}

#[test]
fn rpc_uses_final_and_paginates() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let export = round(201);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        for i in 0..3 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let body_start;
            loop {
                let mut buf = [0; 4096];
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&buf[..n]);
                if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    body_start = pos + 4;
                    break;
                }
            }
            let headers = String::from_utf8_lossy(&request[..body_start]);
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                        .map(|(_, v)| v.trim().parse().unwrap())
                })
                .unwrap();
            while request.len() < body_start + length {
                let mut buf = [0; 4096];
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&buf[..n]);
            }
            let json: serde_json::Value =
                serde_json::from_slice(&request[body_start..body_start + length]).unwrap();
            assert_eq!(json["params"]["finality"], "final");
            assert_eq!(json["params"]["request_type"], "call_function");
            let args: serde_json::Value = serde_json::from_slice(
                &STANDARD
                    .decode(json["params"]["args_base64"].as_str().unwrap())
                    .unwrap(),
            )
            .unwrap();
            let result = if i == 0 {
                assert_eq!(json["params"]["method_name"], "get_round");
                assert_eq!(args, serde_json::json!({"mode":1,"id":12}));
                serde_json::to_vec(&export.round).unwrap()
            } else {
                assert_eq!(json["params"]["method_name"], "get_log");
                assert_eq!(args["limit"], 200);
                let from = if i == 1 { 0 } else { 200 };
                assert_eq!(args["from_idx"], from);
                serde_json::to_vec(&export.rows[from..(from + 200).min(201)]).unwrap()
            };
            let response = serde_json::json!({"jsonrpc":"2.0","id":"rule-verifier","result":{"result":result}}).to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
        }
    });
    let result = Command::new(env!("CARGO_BIN_EXE_rule"))
        .args([
            "verify",
            "--network",
            "testnet",
            "--game",
            "game.testnet",
            "--mode",
            "team",
            "--round",
            "12",
            "--rpc-url",
            &format!("http://{addr}"),
            "--json",
        ])
        .output()
        .unwrap();
    server.join().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&result.stdout).unwrap(),
        serde_json::json!({"status":"pass","matched":201,"total":201})
    );
}
