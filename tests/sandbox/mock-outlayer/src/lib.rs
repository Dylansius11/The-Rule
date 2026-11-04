//! MOCK OutLayer for sandbox tests only. This contract does not execute WASM.
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U64;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::Value;
use near_sdk::store::Vector;
use near_sdk::{
    AccountId, Gas, GasWeight, PanicOnDefault, Promise, PromiseError, YieldId, env, near,
};

#[derive(BorshDeserialize, BorshSerialize)]
struct Request {
    yield_id: YieldId,
    caller: AccountId,
    input_data: Option<String>,
    resolved: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct Resolution {
    pub value: Option<Value>,
    pub error: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockOutlayer {
    requests: Vector<Request>,
}

#[near]
impl MockOutlayer {
    #[init]
    pub fn new() -> Self {
        Self {
            requests: Vector::new(b"r"),
        }
    }

    /// Same call shape as OutLayer; the request is suspended until `resolve`.
    #[payable]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) -> Promise {
        let _ = (
            source,
            resource_limits,
            secrets_ref,
            response_format,
            payer_account_id,
            params,
        );
        let (promise, yield_id) =
            Promise::new_yield("on_resume", b"{}", Gas::from_tgas(10), GasWeight(0));
        self.requests.push(Request {
            yield_id,
            caller: env::predecessor_account_id(),
            input_data,
            resolved: false,
        });
        promise
    }

    pub fn request_count(&self) -> U64 {
        U64(u64::from(self.requests.len()))
    }

    pub fn get_request(&self, id: u32) -> Option<(AccountId, Option<String>)> {
        self.requests
            .get(id)
            .map(|r| (r.caller.clone(), r.input_data.clone()))
    }

    /// Resuming an expired or already resumed request returns false.
    pub fn resolve(&mut self, id: u32, resolution: Resolution) -> bool {
        let Some(request) = self.requests.get_mut(id) else {
            return false;
        };
        if request.resolved {
            return false;
        }
        let Ok(data) = near_sdk::serde_json::to_vec(&resolution) else {
            return false;
        };
        if request.yield_id.resume(data).is_err() {
            return false;
        }
        request.resolved = true;
        true
    }

    #[private]
    pub fn on_resume(&self, #[callback_result] result: Result<Resolution, PromiseError>) -> Value {
        match result {
            Ok(Resolution {
                value,
                error: false,
            }) => value.unwrap_or(Value::Null),
            _ => env::panic_str("MOCK_OUTLAYER_ERROR"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json::json;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn forwards_json_and_null_to_the_caller() {
        testing_env!(VMContextBuilder::new().build());
        let contract = MockOutlayer::new();
        assert_eq!(
            contract.on_resume(Ok(Resolution {
                value: Some(json!({"v": 1})),
                error: false,
            })),
            json!({"v": 1})
        );
        assert_eq!(
            contract.on_resume(Ok(Resolution {
                value: None,
                error: false,
            })),
            Value::Null
        );
    }
}
