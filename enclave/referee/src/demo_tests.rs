use super::*;
use serde_json::{Value, json};

struct Stub;
impl Mac for Stub {
    fn mac(&self, data: &[u8]) -> Result<[u8; 32], Failure> {
        Ok(if data.starts_with(protocol::SALT_DOMAIN) {
            [9; 32]
        } else {
            [8; 32]
        })
    }
}

#[test]
fn demo_uses_preselected_rule_and_fair_bucket() {
    if std::env::var_os("REFEREE_DEMO_TEST_CHILD").is_none() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "demo_tests::demo_uses_preselected_rule_and_fair_bucket",
            ])
            .env("REFEREE_DEMO_TEST_CHILD", "1")
            .env("RULE_DEMO", r#"{"v":"g1","form":0,"lits":[[0,0]]}"#)
            .status()
            .unwrap();
        assert!(status.success());
        return;
    }
    let input = json!({"op":"begin","g":"g1","chain":"testnet","game":"game.testnet","mode":0,"round":7,"seed":"00".repeat(32),"commit":null});
    let begin: Value =
        serde_json::from_slice(&execute(&serde_json::to_vec(&input).unwrap(), &Stub).unwrap())
            .unwrap();
    assert_eq!(begin["header"]["bucket"], "mid");
    let mut open = input;
    open["op"] = json!("open");
    open["commit"] = begin["commit"].clone();
    let revealed: Value =
        serde_json::from_slice(&execute(&serde_json::to_vec(&open).unwrap(), &Stub).unwrap())
            .unwrap();
    assert_eq!(revealed["rule"], json!({"v":"g1","form":0,"lits":[[0,0]]}));
}

#[test]
fn demo_rejects_missing_invalid_and_unfair_rules() {
    if std::env::var_os("REFEREE_DEMO_BAD_CHILD").is_none() {
        for rule in [
            None,
            Some("invalid"),
            Some(r#"{"v":"g1","form":0,"lits":[[57,0]]}"#),
        ] {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap());
            child
                .args([
                    "--exact",
                    "demo_tests::demo_rejects_missing_invalid_and_unfair_rules",
                ])
                .env("REFEREE_DEMO_BAD_CHILD", "1")
                .env_remove("RULE_DEMO");
            if let Some(rule) = rule {
                child.env("RULE_DEMO", rule);
            }
            assert!(child.status().unwrap().success());
        }
        return;
    }
    let input = json!({"op":"begin","g":"g1","chain":"testnet","game":"game.testnet","mode":0,"round":7,"seed":"00".repeat(32),"commit":null});
    assert!(execute(&serde_json::to_vec(&input).unwrap(), &Stub).is_err());
}
