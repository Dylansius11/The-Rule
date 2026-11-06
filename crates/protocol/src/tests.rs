use crate::*;
use alloc::format;
use serde_json::{Value, json};

#[test]
fn golden_referee_io() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/vectors/referee-io.json")).unwrap();
    for row in f["requests"].as_array().unwrap() {
        let request: RefereeRequest = serde_json::from_value(row.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), *row);
    }
    for row in f["responses"].as_array().unwrap() {
        let response: RefereeResponse = serde_json::from_value(row.clone()).unwrap();
        assert_eq!(serde_json::to_value(response).unwrap(), *row);
    }
}
#[test]
fn golden_commit() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/vectors/commit.json")).unwrap();
    let guess = serde_json::from_value(f["rule"].clone()).unwrap();
    let actual = commit_preimage(&CommitPreimage {
        chain: f["chain"].as_str().unwrap(),
        game: f["game"].as_str().unwrap(),
        mode: Mode::Solo,
        round: 7,
        actor: f["actor"].as_str().unwrap(),
        entity: Entity::Solo(42),
        guess: &guess,
        salt: &[17; 32],
    });
    let expected: Vec<u8> = serde_json::from_value(f["preimage"].clone()).unwrap();
    assert_eq!(actual, expected);
}
#[test]
fn rejects_unknown_fields_extra_keys_wrong_lengths_and_null() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/vectors/referee-io.json")).unwrap();
    for row in f["requests"].as_array().unwrap() {
        let mut bad = row.clone();
        bad["extra"] = json!(true);
        assert!(serde_json::from_value::<RefereeRequest>(bad).is_err());
    }
    for row in f["responses"].as_array().unwrap() {
        let mut bad = row.clone();
        bad["extra"] = json!(true);
        assert!(serde_json::from_value::<RefereeResponse>(bad).is_err());
    }
    assert!(serde_json::from_value::<RefereeRequest>(Value::Null).is_err());
    assert!(serde_json::from_value::<RefereeResponse>(Value::Null).is_err());
    assert!(serde_json::from_value::<RefereeResponse>(json!({"v":2})).is_err());
    assert!(serde_json::from_value::<RefereeResponse>(json!({"v":1,"correct":true})).is_err());
    let mut wrong = f["responses"][0].clone();
    wrong["commit"] = json!("00");
    assert!(serde_json::from_value::<RefereeResponse>(wrong).is_err());
    let mut wrong = f["requests"][2].clone();
    wrong["guess"] = json!("00");
    assert!(serde_json::from_value::<RefereeRequest>(wrong).is_err());
    let mut wrong = f["requests"][1].clone();
    wrong["play"]["number"] = json!(1000);
    assert!(serde_json::from_value::<RefereeRequest>(wrong).is_err());
}

#[test]
fn referee_context_and_grammar_golden_vector() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/vectors/referee-io.json")).unwrap();
    let vector = &fixture["stub_mac_vectors"];
    let context = referee_context("testnet", "game.testnet", Mode::Solo, 7, &[0; 32]);
    let hex: String = context.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, vector["context_hex"].as_str().unwrap());
    assert_eq!(
        serde_json::to_value(Hex32(grammar_hash())).unwrap(),
        vector["begin_response"]["header"]["grammar"]
    );
}

#[test]
fn token_outcomes_reject_ambiguous_or_extended_wire_data() {
    use crate::token::TokenOutcome;
    let valid = json!({
        "operation": {
            "operation_id": 42, "kind": "mint",
            "account_id": "player.testnet", "amount": "100"
        },
        "status": "applied"
    });
    let mut malformed = Vec::new();
    let mut extra = valid.clone();
    extra["extra"] = json!(true);
    malformed.push(extra);
    let mut extra = valid.clone();
    extra["operation"]["extra"] = json!(true);
    malformed.push(extra);
    for amount in [
        json!(100),
        json!("0100"),
        json!("-1"),
        json!("1e2"),
        json!(""),
    ] {
        let mut wrong = valid.clone();
        wrong["operation"]["amount"] = amount;
        malformed.push(wrong);
    }
    let mut wrong = valid.clone();
    wrong["operation"]["kind"] = json!("transfer");
    malformed.push(wrong);
    let mut wrong = valid.clone();
    wrong["status"] = json!("unknown");
    malformed.push(wrong);
    malformed.push(Value::Null);
    for value in malformed {
        assert!(serde_json::from_value::<TokenOutcome>(value).is_err());
    }
    assert!(serde_json::from_str::<TokenOutcome>(
        r#"{"operation":{"operation_id":42,"kind":"mint","account_id":"p.testnet","amount":"1"},"status":"applied","status":"cap_exceeded"}"#
    ).is_err());
}
