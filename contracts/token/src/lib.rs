//! RULE: a capped NEP-141 token with an immutable game minter.
use near_contract_standards::fungible_token::{
    FungibleToken,
    core::FungibleTokenCore,
    events::FtMint,
    metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider},
    resolver::FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, PromiseOrValue, env, json_types::U128, near, require,
};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token {
    token: FungibleToken,
    minter: AccountId,
    cap: u128,
    metadata: FungibleTokenMetadata,
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
        }
    }

    /// Mint to an already registered account.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.minter,
            "E54: only minter"
        );
        require!(amount.0 > 0, "E11: zero mint");
        let supply = self
            .token
            .total_supply
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("E55: supply overflow"));
        require!(supply <= self.cap, "E55: cap exceeded");
        require!(
            self.token.accounts.contains_key(&account_id),
            "E52: receiver not registered"
        );
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: None,
        }
        .emit();
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
