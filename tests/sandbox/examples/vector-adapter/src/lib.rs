//! Test-only transport around the production core, protocol and replay functions.
use protocol::{CommitPreimage, Entity, Mode, RefereeRequest, RefereeResponse, commit_preimage};
use rule_core::{Bucket, CanonicalRule, canonical, sample};
use serde_json::{Value, json};

pub fn compute(kind: &str, input: Value) -> Value {
    match kind {
        "rule" => {
            let rule: CanonicalRule = serde_json::from_value(input["rule"].clone()).unwrap();
            let bytes = canonical::encode(&rule);
            let decoded = canonical::decode(&bytes).unwrap();
            json!({"rule": decoded, "bytes": bytes})
        }
        "commit" => {
            let rule: CanonicalRule = serde_json::from_value(input["rule"].clone()).unwrap();
            let mode: Mode = serde_json::from_value(input["mode"].clone()).unwrap();
            let entity = u32::try_from(input["entity"].as_u64().unwrap()).unwrap();
            let salt = [u8::try_from(input["salt_byte"].as_u64().unwrap()).unwrap(); 32];
            json!(commit_preimage(&CommitPreimage {
                chain: input["chain"].as_str().unwrap(),
                game: input["game"].as_str().unwrap(),
                mode,
                round: u32::try_from(input["round"].as_u64().unwrap()).unwrap(),
                actor: input["actor"].as_str().unwrap(),
                entity: Entity::Solo(entity),
                guess: &rule,
                salt: &salt,
            }))
        }
        "sample" => {
            let seed = input["seed"].as_str().unwrap();
            assert_eq!(seed.len() % 2, 0);
            let seed_bytes: Vec<u8> = seed
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
                .collect();
            let (rule, bucket) = sample(&seed_bytes);
            let encoded: String = canonical::encode(&rule)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            let bucket = match bucket {
                Bucket::Rare => "rare",
                Bucket::Mid => "mid",
                Bucket::Common => "common",
            };
            json!({"seed":seed, "rule":encoded, "bucket":bucket})
        }
        "request" => {
            let request: RefereeRequest = serde_json::from_value(input).unwrap();
            serde_json::to_value(request).unwrap()
        }
        "response" => {
            let response: RefereeResponse = serde_json::from_value(input).unwrap();
            serde_json::to_value(response).unwrap()
        }
        "replay" => {
            let export: verifier_cli::Export = serde_json::from_value(input).unwrap();
            serde_json::to_value(verifier_cli::verify_export(&export)).unwrap()
        }
        _ => panic!("unknown fixture kind: {kind}"),
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown", feature = "contract"))]
mod contract {
    use near_sdk::{near, serde_json::Value};

    #[near(contract_state)]
    #[derive(Default)]
    pub struct VectorAdapter {}

    #[near]
    impl VectorAdapter {
        pub fn run(&self, kind: String, input: Value) -> Value {
            super::compute(&kind, input)
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown", feature = "web"))]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn run_vector(kind: &str, input: &str) -> String {
    let input = serde_json::from_str(input).expect("invalid vector input");
    serde_json::to_string(&compute(kind, input)).expect("invalid vector output")
}
