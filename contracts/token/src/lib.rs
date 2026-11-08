//! RULE: a capped NEP-141 token with an immutable game minter.
use near_contract_standards::fungible_token::{
    FungibleToken,
    core::FungibleTokenCore,
    events::{FtMint, FtTransfer},
    metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider},
    resolver::FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, PromiseOrValue, collections::LookupMap, env,
    json_types::U128, near, require,
};
use protocol::{
    params::Amount,
    token::{
        TOKEN_OPERATION_STORAGE_BYTES, TokenOperation, TokenOperationFunding, TokenOperationKind,
        TokenOperationStatus, TokenOutcome,
    },
};

// The key stores the operation id; only the remaining bounded payload and status are retained.
#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
struct OperationRecord {
    account_id: AccountId,
    amount: u128,
    kind: u8,
    status: u8,
}

impl OperationRecord {
    fn outcome(&self, operation_id: u64) -> TokenOutcome {
        let kind = match self.kind {
            0 => TokenOperationKind::Mint,
            1 => TokenOperationKind::Unlock,
            _ => env::panic_str("invalid stored operation kind"),
        };
        let status = match self.status {
            0 => TokenOperationStatus::Applied,
            1 => TokenOperationStatus::ReceiverUnregistered,
            2 => TokenOperationStatus::InsufficientBalance,
            3 => TokenOperationStatus::CapExceeded,
            4 => TokenOperationStatus::InvalidAmount,
            _ => env::panic_str("invalid stored operation status"),
        };
        TokenOutcome {
            operation: TokenOperation {
                operation_id,
                kind,
                account_id: self.account_id.to_string(),
                amount: Amount(self.amount),
            },
            status,
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token {
    token: FungibleToken,
    minter: AccountId,
    cap: u128,
    metadata: FungibleTokenMetadata,
    operations: LookupMap<u64, OperationRecord>,
    operation_funding: u128,
    completed_operations: u64,
}

#[near]
impl Token {
    #[init]
    pub fn new(minter: AccountId, cap: U128, metadata: FungibleTokenMetadata) -> Self {
        metadata.assert_valid();
        require!(
            metadata.decimals == 18 && metadata.symbol == "RULE",
            "E11: invalid token metadata"
        );
        require!(cap.0 > 0, "E11: zero cap");
        Self {
            token: FungibleToken::new(b"a"),
            minter,
            cap: cap.0,
            metadata,
            operations: LookupMap::new(b"o"),
            operation_funding: 0,
            completed_operations: 0,
        }
    }

    /// Execute a fixed-minter operation once, retaining its terminal outcome permanently.
    pub fn execute_operation(&mut self, operation: TokenOperation) -> TokenOutcome {
        require!(
            env::predecessor_account_id() == self.minter,
            "E54: only minter"
        );
        let receiver: AccountId = operation
            .account_id
            .parse()
            .unwrap_or_else(|_| env::panic_str("E11: invalid account"));
        require!(
            operation.kind != TokenOperationKind::Unlock || receiver != self.minter,
            "E11: unlock receiver is minter"
        );
        if let Some(record) = self.operations.get(&operation.operation_id) {
            let outcome = record.outcome(operation.operation_id);
            require!(outcome.operation == operation, "E11: operation conflict");
            return outcome;
        }
        let cost = Self::operation_cost();
        require!(
            self.operation_funding >= cost,
            "E24: insufficient operation funding"
        );
        let completed = self
            .completed_operations
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("E24: operation count overflow"));
        let amount = operation.amount.0;
        let status = if amount == 0 {
            TokenOperationStatus::InvalidAmount
        } else if !self.token.accounts.contains_key(&receiver) {
            TokenOperationStatus::ReceiverUnregistered
        } else {
            match operation.kind {
                TokenOperationKind::Mint => {
                    if self
                        .token
                        .total_supply
                        .checked_add(amount)
                        .is_none_or(|s| s > self.cap)
                    {
                        TokenOperationStatus::CapExceeded
                    } else {
                        TokenOperationStatus::Applied
                    }
                }
                TokenOperationKind::Unlock => {
                    let balance = self.token.accounts.get(&self.minter).unwrap_or(0);
                    if balance < amount {
                        TokenOperationStatus::InsufficientBalance
                    } else if self
                        .token
                        .accounts
                        .get(&receiver)
                        .unwrap_or(0)
                        .checked_add(amount)
                        .is_none()
                    {
                        TokenOperationStatus::InvalidAmount
                    } else {
                        TokenOperationStatus::Applied
                    }
                }
            }
        };
        if status == TokenOperationStatus::Applied {
            match operation.kind {
                TokenOperationKind::Mint => {
                    self.token.internal_deposit(&receiver, amount);
                    FtMint {
                        owner_id: &receiver,
                        amount: U128(amount),
                        memo: None,
                    }
                    .emit();
                }
                TokenOperationKind::Unlock => {
                    self.token.internal_withdraw(&self.minter, amount);
                    self.token.internal_deposit(&receiver, amount);
                    FtTransfer {
                        old_owner_id: &self.minter,
                        new_owner_id: &receiver,
                        amount: U128(amount),
                        memo: None,
                    }
                    .emit();
                }
            }
        }
        let record = OperationRecord {
            account_id: receiver,
            amount,
            kind: match operation.kind {
                TokenOperationKind::Mint => 0,
                TokenOperationKind::Unlock => 1,
            },
            status: match status {
                TokenOperationStatus::Applied => 0,
                TokenOperationStatus::ReceiverUnregistered => 1,
                TokenOperationStatus::InsufficientBalance => 2,
                TokenOperationStatus::CapExceeded => 3,
                TokenOperationStatus::InvalidAmount => 4,
            },
        };
        self.operations.insert(&operation.operation_id, &record);
        self.operation_funding -= cost;
        self.completed_operations = completed;
        TokenOutcome { operation, status }
    }

    #[payable]
    pub fn fund_operations(&mut self) -> TokenOperationFunding {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "E11: zero operation funding");
        self.operation_funding = self
            .operation_funding
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("E24: operation funding overflow"));
        self.get_operation_funding()
    }

    pub fn get_operation(&self, operation_id: u64) -> Option<TokenOutcome> {
        self.operations
            .get(&operation_id)
            .map(|record| record.outcome(operation_id))
    }

    pub fn get_operation_funding(&self) -> TokenOperationFunding {
        TokenOperationFunding {
            available: Amount(self.operation_funding),
            cost_per_operation: Amount(Self::operation_cost()),
            completed: self.completed_operations,
        }
    }

    fn operation_cost() -> u128 {
        u128::from(TOKEN_OPERATION_STORAGE_BYTES) * env::storage_byte_cost().as_yoctonear()
    }
}

#[near]
impl FungibleTokenCore for Token {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "E51: exactly 1 yoctoNEAR required"
        );
        self.token.ft_transfer(receiver_id, amount, memo)
    }
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "E51: exactly 1 yoctoNEAR required"
        );
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Token {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}

#[near]
impl StorageManagement for Token {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "E51: exactly 1 yoctoNEAR required"
        );
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "E51: exactly 1 yoctoNEAR required"
        );
        require!(force != Some(true), "E53: force unregister rejected");
        require!(
            env::predecessor_account_id() != self.minter,
            "E53: minter unregister rejected"
        );
        self.token.storage_unregister(force)
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Token {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

#[cfg(test)]
mod tests;
