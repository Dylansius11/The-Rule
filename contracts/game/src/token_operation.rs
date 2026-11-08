//! Fixed-receiver, idempotent RULE operation scheduling and acknowledgement validation.
use super::*;
use protocol::params::Amount;
use protocol::token::{TokenOperation, TokenOperationKind, TokenOperationStatus, TokenOutcome};

const MINT_CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near]
impl Game {
    /// The immutable operation for a pending mint or unlock, if any.
    pub fn get_token_operation(&self, request_id: u64) -> Option<TokenOperation> {
        let (kind, actor, amount) = match self.pending.get(&request_id)? {
            Request::Mint { actor, amount, .. } => (TokenOperationKind::Mint, actor, *amount),
            Request::Unlock { actor, amount, .. } => (TokenOperationKind::Unlock, actor, *amount),
            _ => return None,
        };
        Some(TokenOperation {
            operation_id: request_id,
            kind,
            account_id: actor.to_string(),
            amount: Amount(amount),
        })
    }

    /// Anyone may replay an unresolved operation without changing its identity or debiting funds.
    pub fn retry_token_operation(&mut self, request_id: u64) {
        let operation = self
            .get_token_operation(request_id)
            .unwrap_or_else(|| env::panic_str("E50"));
        let p = self.params();
        let callback = callback_gas(operation.kind, &p);
        let required = p
            .gas_mint
            .saturating_add(callback.as_gas())
            .saturating_add(Gas::from_tgas(5).as_gas());
        near_sdk::require!(
            env::prepaid_gas()
                .as_gas()
                .saturating_sub(env::used_gas().as_gas())
                >= required,
            "E50"
        );
        self.schedule_token_operation(operation);
    }
}

fn callback_gas(kind: TokenOperationKind, p: &Params) -> Gas {
    match kind {
        TokenOperationKind::Mint => MINT_CALLBACK_GAS,
        TokenOperationKind::Unlock => Gas::from_gas(p.gas_callback),
    }
}

impl Game {
    pub(crate) fn schedule_token_operation(&self, operation: TokenOperation) {
        let p = self.params();
        let token: AccountId = p.token.parse().expect("validated at init");
        let callback = match operation.kind {
            TokenOperationKind::Mint => "on_mint",
            TokenOperationKind::Unlock => "on_unlock",
        };
        let gas = callback_gas(operation.kind, &p);
        let id = operation.operation_id;
        Promise::new(token)
            .function_call(
                "execute_operation",
                serde_json::to_vec(&json!({"operation": operation}))
                    .expect("arguments serialization"),
                NearToken::from_yoctonear(0),
                Gas::from_gas(p.gas_mint),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                callback,
                serde_json::to_vec(&json!({"request_id": id})).expect("callback serialization"),
                NearToken::from_yoctonear(0),
                gas,
            ))
            .detach();
    }

    pub(crate) fn token_outcome(
        &self,
        id: u64,
        kind: TokenOperationKind,
    ) -> Option<TokenOperationStatus> {
        let operation = self.get_token_operation(id)?;
        if operation.kind != kind {
            return None;
        }
        let bytes = env::promise_result_checked(0, 1024).ok()?;
        let outcome: TokenOutcome = serde_json::from_slice(&bytes).ok()?;
        if outcome.operation != operation {
            return None;
        }
        match (kind, outcome.status) {
            (
                _,
                TokenOperationStatus::Applied
                | TokenOperationStatus::ReceiverUnregistered
                | TokenOperationStatus::InvalidAmount,
            )
            | (TokenOperationKind::Mint, TokenOperationStatus::CapExceeded)
            | (TokenOperationKind::Unlock, TokenOperationStatus::InsufficientBalance) => {
                Some(outcome.status)
            }
            _ => None,
        }
    }
}
