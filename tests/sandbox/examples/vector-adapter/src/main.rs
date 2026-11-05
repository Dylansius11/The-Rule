use serde_json::{Value, json};

fn main() {
    let rules: Vec<Value> =
        serde_json::from_str(include_str!("../../../../vectors/rule.json")).unwrap();
    let samples: Vec<Value> =
        serde_json::from_str(include_str!("../../../../vectors/sample.json")).unwrap();
    let commit: Value =
        serde_json::from_str(include_str!("../../../../vectors/commit.json")).unwrap();
    let io: Value =
        serde_json::from_str(include_str!("../../../../vectors/referee-io.json")).unwrap();
    let replay: Vec<Value> =
        serde_json::from_str(include_str!("../../../../vectors/verify.json")).unwrap();
    assert!(!rules.is_empty() && !samples.is_empty() && !replay.is_empty());
    let mut cases = Vec::new();
    for rule in rules {
        cases.push(json!({"kind":"rule", "input":rule, "expected":rule}));
    }
    cases.push(json!({"kind":"commit", "input":commit, "expected":commit["preimage"]}));
    for sample in samples {
        cases.push(json!({"kind":"sample", "input":sample, "expected":sample}));
    }
    for (field, kind) in [("requests", "request"), ("responses", "response")] {
        let rows = io[field].as_array().unwrap();
        assert!(!rows.is_empty());
        for row in rows {
            cases.push(json!({"kind":kind, "input":row, "expected":row}));
        }
    }
    for row in replay {
        cases.push(json!({"kind":"replay", "input":row["export"], "expected":row["expected"]}));
    }
    for (index, case) in cases.iter().enumerate() {
        let actual = vector_adapter::compute(case["kind"].as_str().unwrap(), case["input"].clone());
        assert_eq!(actual, case["expected"], "vector {index}");
    }
    println!("{}", serde_json::to_string(&cases).unwrap());
}
