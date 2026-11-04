use protocol::Hex32;
use rule_core::CanonicalRule;
use verifier_cli::Row;
use wasm_bindgen::prelude::*;

/// JSON input strings use the same round and log types as the native verifier.
/// Returns a JSON verification result; malformed inputs throw a JS exception.
#[wasm_bindgen]
pub fn verify_round(
    rows: &str,
    rule: &str,
    salt: &str,
    commit: &str,
    log_len: u32,
) -> Result<String, JsValue> {
    let rows: Vec<Row> = parse(rows)?;
    let rule: CanonicalRule = parse(rule)?;
    let salt: Hex32 = parse(salt)?;
    let commit: Hex32 = parse(commit)?;
    serde_json::to_string(&verifier_cli::verify_round(
        &rows, &rule, salt, commit, log_len,
    ))
    .map_err(error)
}

#[wasm_bindgen]
pub fn consistent(rule: &str, rows: &str) -> Result<String, JsValue> {
    let rule: CanonicalRule = parse(rule)?;
    let rows: Vec<Row> = parse(rows)?;
    serde_json::to_string(&verifier_cli::consistent(&rule, &rows)).map_err(error)
}

fn parse<T: serde::de::DeserializeOwned>(input: &str) -> Result<T, JsValue> {
    serde_json::from_str(input).map_err(error)
}
fn error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
