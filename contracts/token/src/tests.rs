use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env};

fn account(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(predecessor: &str, deposit: u128) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build()
    );
}
fn metadata() -> FungibleTokenMetadata {
    FungibleTokenMetadata {
        spec: "ft-1.0.0".into(),
        name: "THE RULE".into(),
        symbol: "RULE".into(),
        icon: None,
        reference: None,
        reference_hash: None,
        decimals: 18,
    }
}

#[test]
fn t_tok_1_mint_exact_cap_and_balances() {
    context("game.testnet", 0);
    let mut token = Token::new(account("game.testnet"), U128(100), metadata());
    let storage = token.storage_balance_bounds().min.as_yoctonear();
    context("game.testnet", storage);
    token.storage_deposit(Some(account("alice.testnet")), None);
    context("game.testnet", 0);
    token.mint(account("alice.testnet"), U128(100));
    assert_eq!(token.ft_total_supply().0, 100);
    assert_eq!(token.ft_balance_of(account("alice.testnet")).0, 100);
    assert_eq!(token.ft_metadata().decimals, 18);
}

#[test]
fn t_tok_2_transfer_and_supply_invariant() {
    context("game.testnet", 0);
    let mut token = Token::new(account("game.testnet"), U128(100), metadata());
    let storage = token.storage_balance_bounds().min.as_yoctonear();
    context("game.testnet", storage);
    token.storage_deposit(Some(account("alice.testnet")), None);
    context("game.testnet", 0);
    token.mint(account("alice.testnet"), U128(75));
    context("bob.testnet", storage);
    token.storage_deposit(None, None);
    context("alice.testnet", 1);
    token.ft_transfer(account("bob.testnet"), U128(20), None);
    let alice = token.ft_balance_of(account("alice.testnet")).0;
    let bob = token.ft_balance_of(account("bob.testnet")).0;
    assert_eq!((alice, bob), (55, 20));
    assert_eq!(alice + bob, token.ft_total_supply().0);
}

#[test]
fn t_tok_3_resolver_burn_when_sender_unregisters() {
    context("game.testnet", 0);
    let mut token = Token::new(account("game.testnet"), U128(100), metadata());
    let storage = token.storage_balance_bounds().min.as_yoctonear();
    context("game.testnet", storage);
    token.storage_deposit(Some(account("alice.testnet")), None);
    context("game.testnet", storage);
    token.storage_deposit(Some(account("bob.testnet")), None);
    context("game.testnet", 0);
    token.mint(account("alice.testnet"), U128(100));
    context("alice.testnet", 1);
    token.ft_transfer(account("bob.testnet"), U128(100), None);
    assert!(token.storage_unregister(Some(false)));
    #[allow(deprecated)]
    near_sdk::test_utils::testing_env_with_promise_results(
        VMContextBuilder::new()
            .current_account_id(account("token.testnet"))
            .build(),
        near_sdk::PromiseResult::Successful(b"\"100\"".to_vec()),
    );
    token.ft_resolve_transfer(account("alice.testnet"), account("bob.testnet"), U128(100));
    assert_eq!(token.ft_total_supply().0, 0);
    assert_eq!(token.ft_balance_of(account("bob.testnet")).0, 0);
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|line| line.contains("ft_burn"))
    );
}

#[test]
#[should_panic(expected = "E55: supply overflow")]
fn t_tok_4_mint_supply_overflow() {
    context("game.testnet", 0);
    let mut token = Token::new(account("game.testnet"), U128(u128::MAX), metadata());
    let storage = token.storage_balance_bounds().min.as_yoctonear();
    context("game.testnet", storage);
    token.storage_deposit(Some(account("alice.testnet")), None);
    context("game.testnet", 0);
    token.mint(account("alice.testnet"), U128(u128::MAX));
    token.mint(account("alice.testnet"), U128(1));
}
