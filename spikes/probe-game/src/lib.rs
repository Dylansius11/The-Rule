use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, Promise, PromiseResult};
use near_sdk::collections::LookupMap;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json};

// Quote from outlayer.testnet estimate_execution_cost for LIMITS on 2026-11-04.
const DEPOSIT: u128 = 7_000_100_000_000_000_000_000;

#[ext_contract(ext_outlayer)]
trait OutLayer {
    fn request_execution(&mut self, source: serde_json::Value, resource_limits: Option<serde_json::Value>, input_data: Option<String>, secrets_ref: Option<serde_json::Value>, response_format: Option<String>, payer_account_id: Option<AccountId>, params: Option<serde_json::Value>);
}

#[ext_contract(ext_self)]
trait Callback {
    fn on_probe(&mut self, round: u32, seed: String, started_ns: u64);
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Digest { d: String }

#[near(contract_state)]
pub struct ProbeGame {
    results: LookupMap<String, String>,
}

impl Default for ProbeGame {
    fn default() -> Self { Self { results: LookupMap::new(b"r") } }
}

#[near]
impl ProbeGame {
    pub fn probe(&mut self, round: u32, seed: String, url: String, hash: String) -> Promise {
        let input = json!({"op":"derive", "round":round, "seed":seed}).to_string();
        let limits = json!({"max_instructions":1_000_000_000u64,"max_memory_mb":128,"max_execution_seconds":60});
        ext_outlayer::ext("outlayer.testnet".parse().unwrap())
            .with_attached_deposit(NearToken::from_yoctonear(DEPOSIT))
            .with_static_gas(Gas::from_tgas(100))
            .request_execution(json!({"WasmUrl":{"url":url,"hash":hash,"build_target":"wasm32-wasip2"}}), Some(limits), Some(input), None, Some("Json".into()), None, None)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_probe(round, seed, env::block_timestamp()))
    }

    pub fn probe_batch(&mut self, round: u32, url: String, hash: String) {
        for i in 0..10 {
            let seed = format!("batch-{i}");
            let input = json!({"op":"derive", "round":round, "seed":seed}).to_string();
            let limits = json!({"max_instructions":1_000_000_000u64,"max_memory_mb":128,"max_execution_seconds":60});
            ext_outlayer::ext("outlayer.testnet".parse().unwrap())
                .with_attached_deposit(NearToken::from_yoctonear(DEPOSIT))
                .with_static_gas(Gas::from_tgas(65))
                .request_execution(json!({"WasmUrl":{"url":url,"hash":hash,"build_target":"wasm32-wasip2"}}), Some(limits), Some(input), None, Some("Json".into()), None, None)
                .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_probe(round, seed, env::block_timestamp())).detach();
        }
    }

    pub fn probe_failure(&mut self, round: u32, seed: String, url: String, hash: String, input: String, limits: serde_json::Value) -> Promise {
        ext_outlayer::ext("outlayer.testnet".parse().unwrap())
            .with_attached_deposit(NearToken::from_yoctonear(DEPOSIT))
            .with_static_gas(Gas::from_tgas(100))
            .request_execution(json!({"WasmUrl":{"url":url,"hash":hash,"build_target":"wasm32-wasip2"}}), Some(limits), Some(input), None, Some("Json".into()), None, None)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_probe(round, seed, env::block_timestamp()))
    }

    #[private]
    pub fn on_probe(&mut self, round: u32, seed: String, started_ns: u64) {
        let value = match env::promise_result(0) {
            PromiseResult::Successful(bytes) => {
                let parsed = serde_json::from_slice::<Digest>(&bytes).ok().filter(|v| v.d.len() == 64 && v.d.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
                match parsed {
                    Some(d) => json!({"digest":d.d,"raw":String::from_utf8_lossy(&bytes)}),
                    None => json!({"failure":"invalid response","raw":String::from_utf8_lossy(&bytes)}),
                }
            }
            PromiseResult::Failed => json!({"failure":"promise failed"}),
        };
        let value = json!({"result":value,"started_ns":started_ns.to_string(),"finished_ns":env::block_timestamp().to_string()});
        self.results.insert(&format!("{round}:{seed}"), &value.to_string());
    }

    pub fn get_probe(&self, round: u32, seed: String) -> Option<serde_json::Value> {
        self.results.get(&format!("{round}:{seed}")).and_then(|s| serde_json::from_str(&s).ok())
    }
}
