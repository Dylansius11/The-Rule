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

/// Describe a validated canonical rule using the shared grammar.
#[wasm_bindgen]
pub fn describe_rule(rule_json: &str) -> Result<String, JsValue> {
    let rule: CanonicalRule = parse(rule_json)?;
    let (english, dsl) = rule_core::atoms::describe_rule(&rule);
    serde_json::to_string(&serde_json::json!({
        "english": english, "dsl": dsl, "json": serde_json::to_string(&rule).map_err(error)?
    }))
    .map_err(error)
}

/// The complete daily atom catalog and the legal rule shapes.
#[wasm_bindgen]
pub fn atom_catalog() -> Result<String, JsValue> {
    let atoms: Vec<_> = (0..rule_core::atoms::DAILY_ATOMS)
        .filter_map(rule_core::Atom::new)
        .map(|atom| {
            let text = rule_core::atoms::describe_atom(atom);
            serde_json::json!({ "id": atom.id(), "english": text.english, "negated": text.negated, "dsl": text.dsl })
        })
        .collect();
    serde_json::to_string(&serde_json::json!({
        "atoms": atoms,
        "forms": [
            { "id": 0, "name": "Single", "minLiterals": 1, "maxLiterals": 1 },
            { "id": 1, "name": "AND", "minLiterals": 2, "maxLiterals": 2 },
            { "id": 2, "name": "OR", "minLiterals": 2, "maxLiterals": 2 }
        ]
    }))
    .map_err(error)
}

/// Hash a player guess using the protocol's canonical commitment preimage.
#[wasm_bindgen]
pub fn commit_hash(
    chain: &str,
    game: &str,
    mode: u8,
    round: u32,
    actor: &str,
    entity_json: &str,
    guess_json: &str,
    salt_hex: &str,
) -> Result<String, JsValue> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct EntityInput {
        tag: u8,
        id: u32,
    }
    let entity: EntityInput = parse(entity_json)?;
    let entity = match entity.tag {
        0 => protocol::Entity::Solo(entity.id),
        1 => protocol::Entity::Team(entity.id),
        _ => return Err(JsValue::from_str("invalid entity tag")),
    };
    let mode = match mode {
        0 => protocol::Mode::Solo,
        1 => protocol::Mode::Team,
        _ => return Err(JsValue::from_str("invalid mode")),
    };
    let guess: CanonicalRule = parse(guess_json)?;
    let salt: Hex32 =
        serde_json::from_value(serde_json::Value::String(salt_hex.into())).map_err(error)?;
    let hash = protocol::commit_hash(&protocol::CommitPreimage {
        chain,
        game,
        mode,
        round,
        actor,
        entity,
        guess: &guess,
        salt: &salt.0,
    });
    serde_json::to_value(hash)
        .map_err(error)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| JsValue::from_str("invalid hash"))
}

/// Encode a validated rule as protocol rule hex.
#[wasm_bindgen]
pub fn encode_rule_hex(rule_json: &str) -> Result<String, JsValue> {
    let rule: CanonicalRule = parse(rule_json)?;
    serde_json::to_value(protocol::RuleHex(rule))
        .map_err(error)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| JsValue::from_str("invalid rule encoding"))
}

fn parse<T: serde::de::DeserializeOwned>(input: &str) -> Result<T, JsValue> {
    serde_json::from_str(input).map_err(error)
}
fn error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
