use super::*;
use near_sdk::{
    test_utils::{VMContextBuilder, get_logs},
    testing_env,
};

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
fn setup(cap: u128) -> Token {
    context("game.testnet", 0);
    Token::new(account("game.testnet"), U128(cap), metadata())
}
fn register(token: &mut Token, id: &str) {
    let storage = token.storage_balance_bounds().min.as_yoctonear();
    context(id, storage);
    token.storage_deposit(None, None);
}
fn fund(token: &mut Token, count: u128) {
    let cost = token.get_operation_funding().cost_per_operation.0;
    context("contributor.testnet", cost * count);
    token.fund_operations();
}
fn op(id: u64, kind: TokenOperationKind, receiver: &str, amount: u128) -> TokenOperation {
    TokenOperation {
        operation_id: id,
        kind,
        account_id: receiver.into(),
        amount: Amount(amount),
    }
}
fn execute(token: &mut Token, operation: TokenOperation) -> TokenOutcome {
    context("game.testnet", 0);
    token.execute_operation(operation)
}

#[test]
fn funded_exact_replay_and_rejection_are_immutable() {
    let mut token = setup(100);
    fund(&mut token, 3);
    let missing = op(1, TokenOperationKind::Mint, "alice.testnet", 20);
    let rejected = execute(&mut token, missing.clone());
    assert_eq!(rejected.status, TokenOperationStatus::ReceiverUnregistered);
    register(&mut token, "alice.testnet");
    let funding = token.get_operation_funding();
    assert_eq!(execute(&mut token, missing), rejected);
    assert_eq!(token.get_operation_funding(), funding);
    assert!(get_logs().is_empty());
    let mint = op(2, TokenOperationKind::Mint, "alice.testnet", 100);
    let applied = execute(&mut token, mint.clone());
    assert_eq!(applied.status, TokenOperationStatus::Applied);
    let funding = token.get_operation_funding();
    assert_eq!(execute(&mut token, mint), applied);
    assert!(get_logs().is_empty());
    assert_eq!(token.get_operation_funding(), funding);
    assert_eq!(token.get_operation(2), Some(applied));
    assert_eq!(token.ft_total_supply().0, 100);
    assert_eq!(token.ft_balance_of(account("alice.testnet")).0, 100);
    assert_eq!(token.ft_metadata().decimals, 18);
}

#[test]
fn unlock_custody_and_durable_insufficient_balance() {
    let mut token = setup(100);
    register(&mut token, "game.testnet");
    register(&mut token, "alice.testnet");
    fund(&mut token, 4);
    let unlock = op(1, TokenOperationKind::Unlock, "alice.testnet", 30);
    let rejection = execute(&mut token, unlock.clone());
    assert_eq!(rejection.status, TokenOperationStatus::InsufficientBalance);
    assert_eq!(
        execute(
            &mut token,
            op(2, TokenOperationKind::Mint, "game.testnet", 100)
        )
        .status,
        TokenOperationStatus::Applied
    );
    assert_eq!(execute(&mut token, unlock), rejection);
    assert_eq!(
        execute(
            &mut token,
            op(3, TokenOperationKind::Unlock, "alice.testnet", 30)
        )
        .status,
        TokenOperationStatus::Applied
    );
    assert_eq!(token.ft_balance_of(account("game.testnet")).0, 70);
    assert_eq!(token.ft_balance_of(account("alice.testnet")).0, 30);
    assert_eq!(token.ft_total_supply().0, 100);
}

#[test]
fn full_width_cap_and_invalid_amount_are_terminal() {
    let mut token = setup(u128::MAX);
    register(&mut token, "alice.testnet");
    fund(&mut token, 3);
    assert_eq!(
        execute(
            &mut token,
            op(
                u64::MAX,
                TokenOperationKind::Mint,
                "alice.testnet",
                u128::MAX
            )
        )
        .status,
        TokenOperationStatus::Applied
    );
    assert_eq!(
        execute(
            &mut token,
            op(0, TokenOperationKind::Mint, "alice.testnet", 1)
        )
        .status,
        TokenOperationStatus::CapExceeded
    );
    assert_eq!(
        execute(
            &mut token,
            op(1, TokenOperationKind::Unlock, "alice.testnet", 0)
        )
        .status,
        TokenOperationStatus::InvalidAmount
    );
    assert_eq!(token.ft_total_supply().0, u128::MAX);
}

#[test]
fn exact_record_storage_bound() {
    let record = OperationRecord {
        account_id: account(&"a".repeat(64)),
        amount: u128::MAX,
        kind: 1,
        status: 4,
    };
    // Legacy LookupMap uses the one-byte prefix plus the Borsh u64 key. NEAR
    // charges 40 bytes per storage entry in addition to key and value bytes.
    let bytes =
        40 + 1 + borsh::to_vec(&u64::MAX).unwrap().len() + borsh::to_vec(&record).unwrap().len();
    assert!(
        bytes <= TOKEN_OPERATION_STORAGE_BYTES as usize,
        "record uses {bytes} bytes"
    );
}

#[test]
fn standard_transfer_and_resolver_burn() {
    let mut token = setup(100);
    register(&mut token, "alice.testnet");
    register(&mut token, "bob.testnet");
    fund(&mut token, 1);
    execute(
        &mut token,
        op(1, TokenOperationKind::Mint, "alice.testnet", 100),
    );
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
    assert!(get_logs().iter().any(|line| line.contains("ft_burn")));
}

#[test]
#[should_panic(expected = "E24: insufficient operation funding")]
fn insufficient_funding_rejects_before_mutation() {
    let mut token = setup(100);
    register(&mut token, "alice.testnet");
    execute(
        &mut token,
        op(1, TokenOperationKind::Mint, "alice.testnet", 1),
    );
}

#[test]
#[should_panic(expected = "E11: operation conflict")]
fn conflicting_payload_rejected() {
    let mut token = setup(100);
    fund(&mut token, 1);
    execute(
        &mut token,
        op(1, TokenOperationKind::Mint, "alice.testnet", 1),
    );
    execute(
        &mut token,
        op(1, TokenOperationKind::Mint, "alice.testnet", 2),
    );
}

#[test]
#[should_panic(expected = "E54: only minter")]
fn unauthorized_duplicate_rejected() {
    let mut token = setup(100);
    fund(&mut token, 1);
    let operation = op(1, TokenOperationKind::Mint, "alice.testnet", 1);
    execute(&mut token, operation.clone());
    context("stranger.testnet", 0);
    token.execute_operation(operation);
}

#[test]
#[should_panic(expected = "E53: minter unregister rejected")]
fn minter_cannot_unregister() {
    let mut token = setup(100);
    register(&mut token, "game.testnet");
    context("game.testnet", 1);
    token.storage_unregister(Some(false));
}

#[test]
#[should_panic(expected = "E11: unlock receiver is minter")]
fn unlock_to_minter_rejected() {
    let mut token = setup(100);
    execute(
        &mut token,
        op(1, TokenOperationKind::Unlock, "game.testnet", 1),
    );
}

#[test]
#[should_panic(expected = "E24: operation count overflow")]
fn exhausted_counter_cannot_create_free_record() {
    let mut token = setup(100);
    fund(&mut token, 1);
    token.completed_operations = u64::MAX;
    execute(
        &mut token,
        op(1, TokenOperationKind::Mint, "alice.testnet", 1),
    );
}

#[test]
#[should_panic(expected = "E24: operation funding overflow")]
fn funding_cannot_wrap() {
    let mut token = setup(100);
    token.operation_funding = u128::MAX;
    context("contributor.testnet", 1);
    token.fund_operations();
}
