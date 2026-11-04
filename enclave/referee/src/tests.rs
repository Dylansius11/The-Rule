use super::*;
use proptest::prelude::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

struct Stub;
impl Mac for Stub {
    fn mac(&self, data: &[u8]) -> Result<[u8; 32], Failure> {
        let mut h = Sha256::new();
        h.update(b"test-only-stub-key");
        h.update(data);
        Ok(h.finalize().into())
    }
}
fn call(v: &Value) -> Result<Value, Failure> {
    let bytes = execute(&serde_json::to_vec(v).unwrap(), &Stub)?;
    serde_json::from_slice(&bytes).map_err(|_| Failure)
}
fn request() -> Value {
    json!({"op":"begin","g":"g1","chain":"testnet","game":"game.testnet","mode":0,"round":7,"seed":"00".repeat(32),"commit":null})
}
fn round() -> (Value, Value) {
    let mut r = request();
    let begin = call(&r).unwrap();
    r["op"] = json!("open");
    r["commit"] = begin["commit"].clone();
    let opened = call(&r).unwrap();
    (r, opened)
}
#[test]
fn fixed_round_open_matches_commitment() {
    let mut r = request();
    let a = call(&r).unwrap();
    let vector: Value =
        serde_json::from_str(include_str!("../../../tests/vectors/referee-io.json")).unwrap();
    assert_eq!(a, vector["stub_mac_vectors"]["begin_response"]);
    r["op"] = json!("open");
    r["commit"] = a["commit"].clone();
    let opened = call(&r).unwrap();
    let parsed: RefereeResponse = serde_json::from_value(opened.clone()).unwrap();
    if let RefereeResponse::Open { rule, salt } = parsed {
        assert_eq!(
            serde_json::to_value(protocol::round_commitment(&rule, &salt.0)).unwrap(),
            a["commit"]
        );
    } else {
        panic!("wrong response");
    }
    assert_eq!(opened, vector["stub_mac_vectors"]["open_response"]);
    r["op"] = json!("verdict");
    r["play"] = json!({"number":124,"word_id":0,"minute_digit":4,"prev":null});
    assert_eq!(
        call(&r).unwrap(),
        vector["stub_mac_vectors"]["verdict_response"]
    );
    r.as_object_mut().unwrap().remove("play");
    r["op"] = json!("guess");
    r["guess"] = json!("6731010212011f01");
    assert_eq!(
        call(&r).unwrap(),
        vector["stub_mac_vectors"]["guess_response"]
    );
}

#[test]
fn closed_outputs_do_not_contain_rule_salt_or_mac() {
    let (mut request, opened) = round();
    let context =
        protocol::referee_context("testnet", "game.testnet", protocol::Mode::Solo, 7, &[0; 32]);
    let key = Stub
        .mac(&context)
        .unwrap()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let salt = opened["salt"].as_str().unwrap();
    let rule = serde_json::to_string(&opened["rule"]).unwrap();
    let mut begin = request.clone();
    begin["op"] = json!("begin");
    begin["commit"] = Value::Null;
    let mut verdict = request.clone();
    verdict["op"] = json!("verdict");
    verdict["play"] = json!({"number":2,"word_id":0,"minute_digit":0,"prev":null});
    request["op"] = json!("guess");
    request["guess"] = json!("673100010000");
    for input in [begin, verdict, request] {
        let out = execute(&serde_json::to_vec(&input).unwrap(), &Stub).unwrap();
        let text = std::str::from_utf8(&out).unwrap();
        assert!(!text.contains(&key));
        assert!(!text.contains(salt));
        assert!(!text.contains(&rule));
    }
}
#[test]
fn rejection_is_uniform_and_strict() {
    let (mut r, _) = round();
    r["commit"] = json!("11".repeat(32));
    for op in ["open", "verdict", "guess"] {
        let mut bad = r.clone();
        bad["op"] = json!(op);
        if op == "verdict" {
            bad["play"] = json!({"number":2,"word_id":0,"minute_digit":0,"prev":null});
        }
        if op == "guess" {
            bad["guess"] = json!("673100010000");
        }
        assert!(call(&bad).is_err());
    }
    for (field, value) in [
        ("g", json!("g2")),
        ("op", json!("bogus")),
        ("seed", json!("00")),
        ("chain", json!("mainnet")),
        ("game", json!("a")),
        ("extra", json!(true)),
    ] {
        let mut bad = request();
        bad[field] = value;
        assert!(call(&bad).is_err());
    }
    assert!(execute(&vec![b' '; MAX_INPUT + 1], &Stub).is_err());
}
#[test]
fn guess_has_no_counterexample_and_output_shapes_are_fixed() {
    let (mut r, opened) = round();
    let rule: rule_core::CanonicalRule = serde_json::from_value(opened["rule"].clone()).unwrap();
    let hex = |r: &rule_core::CanonicalRule| {
        rule_core::canonical::encode(r)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    r["op"] = json!("guess");
    r["guess"] = json!(hex(&rule));
    assert_eq!(call(&r).unwrap(), json!({"correct":true}));
    let opposite = rule_core::CanonicalRule::new(
        rule_core::Form::Single,
        vec![rule_core::Literal {
            atom: rule_core::Atom::new(0).unwrap(),
            negated: false,
        }],
    )
    .unwrap();
    let other = rule_core::CanonicalRule::new(
        rule_core::Form::Single,
        vec![rule_core::Literal {
            atom: rule_core::Atom::new(0).unwrap(),
            negated: true,
        }],
    )
    .unwrap();
    let (a, b) = (
        rule_core::equivalent(&rule, &opposite),
        rule_core::equivalent(&rule, &other),
    );
    let wrong = if !a {
        opposite
    } else {
        assert!(!b);
        other
    };
    r["guess"] = json!(hex(&wrong));
    assert_eq!(call(&r).unwrap(), json!({"correct":false}));
}

#[test]
fn different_syntax_equivalent_guess_is_accepted() {
    struct Fixed([u8; 32]);
    impl Mac for Fixed {
        fn mac(&self, data: &[u8]) -> Result<[u8; 32], Failure> {
            if data.starts_with(protocol::SALT_DOMAIN) {
                Ok([7; 32])
            } else {
                Ok(self.0)
            }
        }
    }
    let single = rule_core::CanonicalRule::new(
        rule_core::Form::Single,
        vec![rule_core::Literal {
            atom: rule_core::Atom::new(0).unwrap(),
            negated: false,
        }],
    )
    .unwrap();
    let key = (0u32..10_000)
        .find_map(|n| {
            let key: [u8; 32] = Sha256::digest(n.to_le_bytes()).into();
            let mut seed = key.to_vec();
            seed.extend_from_slice(b"rule");
            (rule_core::sample(&seed).0 == single).then_some(key)
        })
        .expect("find fixed test key");
    let host = Fixed(key);
    let begin: Value =
        serde_json::from_slice(&execute(&serde_json::to_vec(&request()).unwrap(), &host).unwrap())
            .unwrap();
    let mut guess = request();
    guess["op"] = json!("guess");
    guess["commit"] = begin["commit"].clone();
    // n even iff n % 4 is 0 or 2.
    guess["guess"] = json!("6731020204000600");
    let response = execute(&serde_json::to_vec(&guess).unwrap(), &host).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&response).unwrap(),
        json!({"correct":true})
    );
}
proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]
    #[test]
    fn verdict_matches_core(number in 0u16..1000, word in 0u8..128, minute in 0u8..10) {
        let (mut r, opened) = round();
        let rule: rule_core::CanonicalRule = serde_json::from_value(opened["rule"].clone()).unwrap();
        let play = rule_core::Play::new(number, word, minute, None).unwrap();
        r["op"] = json!("verdict"); r["play"] = serde_json::to_value(play).unwrap();
        prop_assert_eq!(call(&r).unwrap(), json!({"v":u8::from(rule_core::eval(&rule, &play))}));
    }
}
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]
    #[test]
    fn arbitrary_stdin_never_panics_or_reveals(data in proptest::collection::vec(any::<u8>(), 0..512)) {
        if let Ok(output) = execute(&data, &Stub) {
            let parsed: RefereeResponse = serde_json::from_slice(&output).unwrap();
            prop_assert!(matches!(parsed, RefereeResponse::Begin { .. } | RefereeResponse::Verdict { .. } | RefereeResponse::Guess { .. } | RefereeResponse::Open { .. }), "unexpected response");
        }
    }
}
