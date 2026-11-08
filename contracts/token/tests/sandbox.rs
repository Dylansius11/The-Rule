use near_workspaces::{Account, Contract, types::NearToken};
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::PathBuf};

fn wasm_path() -> PathBuf {
    if let Some(path) = std::env::var_os("TOKEN_WASM") {
        return path.into();
    }
    PathBuf::from(std::env::var_os("CARGO_TARGET_DIR").expect("set CARGO_TARGET_DIR or TOKEN_WASM"))
        .join("near/token/token.wasm")
}

async fn call(
    account: &Account,
    token: &Contract,
    method: &str,
    args: Value,
    deposit: u128,
) -> near_workspaces::result::ExecutionFinalResult {
    account
        .call(token.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(deposit))
        .max_gas()
        .transact()
        .await
        .unwrap()
}
fn assert_rejected(result: near_workspaces::result::ExecutionFinalResult, expected: &str) {
    let error = result
        .into_result()
        .expect_err("expected contract rejection");
    let message = format!("{error:?}");
    assert!(
        message.contains(expected),
        "expected {expected:?}, got {message}"
    );
}
async fn balance(token: &Contract, account: &Account) -> u128 {
    let s: String = token
        .view("ft_balance_of")
        .args_json(json!({"account_id": account.id()}))
        .await
        .unwrap()
        .json()
        .unwrap();
    s.parse().unwrap()
}
fn operation(id: u64, kind: &str, account: &Account, amount: &str) -> Value {
    json!({"operation":{"operation_id":id,"kind":kind,"account_id":account.id(),"amount":amount}})
}
async fn outcome(account: &Account, token: &Contract, args: Value) -> Value {
    call(account, token, "execute_operation", args, 0)
        .await
        .into_result()
        .unwrap()
        .json()
        .unwrap()
}
async fn fund(account: &Account, token: &Contract, count: u128) {
    let funding: Value = token
        .view("get_operation_funding")
        .await
        .unwrap()
        .json()
        .unwrap();
    let cost: u128 = funding["cost_per_operation"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    call(account, token, "fund_operations", json!({}), cost * count)
        .await
        .into_result()
        .unwrap();
}
#[tokio::test]
async fn operation_funding_retry_and_custody() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let token = worker.dev_deploy(&std::fs::read(wasm_path())?).await?;
    let minter = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    let stranger = worker.dev_create_account().await?;
    token.call("new").args_json(json!({"minter":minter.id(), "cap":"100", "metadata":{"spec":"ft-1.0.0", "name":"THE RULE", "symbol":"RULE", "icon":null, "reference":null, "reference_hash":null, "decimals":18}})).transact().await?.into_result()?;
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let storage: u128 = bounds["min"].as_str().unwrap().parse()?;
    call(&minter, &token, "storage_deposit", json!({}), storage)
        .await
        .into_result()?;
    call(&alice, &token, "storage_deposit", json!({}), storage)
        .await
        .into_result()?;
    let mint = operation(u64::MAX, "mint", &minter, "80");
    assert_rejected(
        call(&minter, &token, "execute_operation", mint.clone(), 0).await,
        "E24",
    );
    assert_eq!(balance(&token, &minter).await, 0);
    let absent: Value = token
        .view("get_operation")
        .args_json(json!({"operation_id":u64::MAX}))
        .await?
        .json()?;
    assert!(absent.is_null());
    assert_rejected(
        call(&stranger, &token, "fund_operations", json!({}), 0).await,
        "E11",
    );
    assert!(call(&minter, &token, "execute_operation", json!({"operation":{"operation_id":8,"kind":"other","account_id":alice.id(),"amount":"1"}}), 0).await.into_result().is_err());
    assert_rejected(call(&minter, &token, "execute_operation", json!({"operation":{"operation_id":9,"kind":"mint","account_id":"INVALID","amount":"1"}}), 0).await, "E11");
    let absent: Value = token
        .view("get_operation")
        .args_json(json!({"operation_id":9}))
        .await?
        .json()?;
    assert!(absent.is_null());
    fund(&stranger, &token, 3).await;
    let first = outcome(&minter, &token, mint.clone()).await;
    assert_eq!(first["status"], "applied");
    let funding: Value = token.view("get_operation_funding").await?.json()?;
    let duplicate = call(&minter, &token, "execute_operation", mint.clone(), 0).await;
    assert!(duplicate.logs().is_empty());
    assert_eq!(duplicate.into_result()?.json::<Value>()?, first);
    let after: Value = token.view("get_operation_funding").await?.json()?;
    assert_eq!(funding, after);
    assert_rejected(
        call(&stranger, &token, "execute_operation", mint, 0).await,
        "E54",
    );
    assert_rejected(
        call(
            &minter,
            &token,
            "execute_operation",
            operation(u64::MAX, "mint", &minter, "79"),
            0,
        )
        .await,
        "E11",
    );
    assert_rejected(
        call(
            &minter,
            &token,
            "storage_unregister",
            json!({"force":false}),
            1,
        )
        .await,
        "E53",
    );
    assert_rejected(
        call(
            &minter,
            &token,
            "execute_operation",
            operation(1, "unlock", &minter, "1"),
            0,
        )
        .await,
        "E11",
    );
    let rejected = outcome(&minter, &token, operation(2, "unlock", &alice, "81")).await;
    assert_eq!(rejected["status"], "insufficient_balance");
    assert_eq!(
        outcome(&minter, &token, operation(3, "unlock", &alice, "30")).await["status"],
        "applied"
    );
    assert_eq!(
        outcome(&minter, &token, operation(u64::MAX, "mint", &minter, "80")).await,
        first
    );
    assert_eq!(
        outcome(&minter, &token, operation(2, "unlock", &alice, "81")).await,
        rejected
    );
    assert_eq!(balance(&token, &minter).await, 50);
    assert_eq!(balance(&token, &alice).await, 30);
    let supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(supply, "80");
    Ok(())
}

#[tokio::test]
async fn t_tok_sandbox_initialization_and_supply_overflow() -> Result<(), Box<dyn std::error::Error>>
{
    let worker = near_workspaces::sandbox().await?;
    let token = worker.dev_deploy(&std::fs::read(wasm_path())?).await?;
    let minter = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    let metadata = json!({"spec":"ft-1.0.0", "name":"THE RULE", "symbol":"RULE", "icon":null, "reference":null, "reference_hash":null, "decimals":18});
    let init =
        |cap: &str, metadata: Value| json!({"minter":minter.id(), "cap":cap, "metadata":metadata});
    assert_rejected(
        call(&minter, &token, "new", init("0", metadata.clone()), 0).await,
        "E11: zero cap",
    );
    let mut bad_metadata = metadata.clone();
    bad_metadata["decimals"] = json!(17);
    assert_rejected(
        call(&minter, &token, "new", init("100", bad_metadata), 0).await,
        "E11: invalid token metadata",
    );
    assert!(
        call(
            &minter,
            &token,
            "new",
            init(&u128::MAX.to_string(), metadata),
            0
        )
        .await
        .is_success()
    );
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let storage: u128 = bounds["min"].as_str().unwrap().parse()?;
    fund(&minter, &token, 3).await;
    assert_eq!(
        outcome(&minter, &token, operation(1, "mint", &alice, "1")).await["status"],
        "receiver_unregistered"
    );
    assert!(
        call(&alice, &token, "storage_deposit", json!({}), storage)
            .await
            .is_success()
    );
    assert_eq!(
        outcome(
            &minter,
            &token,
            operation(2, "mint", &alice, &u128::MAX.to_string())
        )
        .await["status"],
        "applied"
    );
    assert_eq!(
        outcome(&minter, &token, operation(3, "mint", &alice, "1")).await["status"],
        "cap_exceeded"
    );
    assert_eq!(balance(&token, &alice).await, u128::MAX);
    Ok(())
}

#[tokio::test]
async fn t_tok_sandbox_mint_transfer_storage_and_refund() -> Result<(), Box<dyn std::error::Error>>
{
    let worker = near_workspaces::sandbox().await?;
    let token = worker.dev_deploy(&std::fs::read(wasm_path())?).await?;
    let minter = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let stranger = worker.dev_create_account().await?;
    token.call("new").args_json(json!({"minter":minter.id(), "cap":"100", "metadata":{"spec":"ft-1.0.0", "name":"THE RULE", "symbol":"RULE", "icon":null, "reference":null, "reference_hash":null, "decimals":18}})).transact().await?.into_result()?;
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let storage: u128 = bounds["min"].as_str().unwrap().parse()?;
    fund(&minter, &token, 5).await;
    assert_rejected(
        call(
            &stranger,
            &token,
            "execute_operation",
            operation(1, "mint", &alice, "1"),
            0,
        )
        .await,
        "E54: only minter",
    );
    let rejected = outcome(&minter, &token, operation(1, "mint", &alice, "1")).await;
    assert_eq!(rejected["status"], "receiver_unregistered");
    assert_rejected(
        call(&alice, &token, "storage_deposit", json!({}), storage - 1).await,
        "The attached deposit is less than the minimum storage balance",
    );
    assert!(
        call(&alice, &token, "storage_deposit", json!({}), storage)
            .await
            .is_success()
    );
    assert!(
        call(&bob, &token, "storage_deposit", json!({}), storage)
            .await
            .is_success()
    );
    assert_eq!(
        outcome(&minter, &token, operation(1, "mint", &alice, "1")).await,
        rejected
    );
    assert_eq!(
        outcome(&minter, &token, operation(2, "mint", &alice, "0")).await["status"],
        "invalid_amount"
    );
    assert_eq!(
        outcome(&minter, &token, operation(3, "mint", &alice, "101")).await["status"],
        "cap_exceeded"
    );
    assert_eq!(
        outcome(&minter, &token, operation(4, "mint", &alice, "100")).await["status"],
        "applied"
    );
    assert_eq!(
        outcome(&minter, &token, operation(5, "mint", &alice, "1")).await["status"],
        "cap_exceeded"
    );
    let transfer =
        |id: &Account, amount: &str| json!({"receiver_id":id.id(),"amount":amount,"memo":null});
    assert_rejected(
        call(&alice, &token, "ft_transfer", transfer(&bob, "1"), 0).await,
        "E51: exactly 1 yoctoNEAR required",
    );
    assert_rejected(
        call(
            &alice,
            &token,
            "ft_transfer_call",
            json!({"receiver_id":bob.id(),"amount":"1","memo":null,"msg":""}),
            0,
        )
        .await,
        "E51: exactly 1 yoctoNEAR required",
    );
    assert_rejected(
        call(&alice, &token, "storage_withdraw", json!({}), 0).await,
        "E51: exactly 1 yoctoNEAR required",
    );
    assert_rejected(
        call(
            &alice,
            &token,
            "storage_unregister",
            json!({"force":false}),
            0,
        )
        .await,
        "E51: exactly 1 yoctoNEAR required",
    );
    assert_rejected(
        call(&alice, &token, "ft_transfer", transfer(&bob, "0"), 1).await,
        "The amount should be a positive number",
    );
    assert_rejected(
        call(&alice, &token, "ft_transfer", transfer(&bob, "101"), 1).await,
        "The account doesn't have enough balance",
    );
    assert_rejected(
        call(&alice, &token, "ft_transfer", transfer(&stranger, "1"), 1).await,
        "is not registered",
    );
    assert_rejected(
        call(
            &alice,
            &token,
            "storage_unregister",
            json!({"force":true}),
            1,
        )
        .await,
        "E53: force unregister rejected",
    );
    assert_rejected(
        call(
            &alice,
            &token,
            "storage_unregister",
            json!({"force":false}),
            1,
        )
        .await,
        "Can't unregister the account with the positive balance without force",
    );
    assert!(
        call(&alice, &token, "ft_transfer", transfer(&bob, "20"), 1)
            .await
            .is_success()
    );
    // Bob has no ft_on_transfer method: the standard resolver refunds the full amount.
    let refund = call(
        &alice,
        &token,
        "ft_transfer_call",
        json!({"receiver_id":bob.id(),"amount":"15","memo":null,"msg":""}),
        1,
    )
    .await;
    assert!(refund.is_success());
    assert_eq!(balance(&token, &alice).await, 80);
    assert_eq!(balance(&token, &bob).await, 20);
    let supply: String = token.view("ft_total_supply").await?.json()?;
    assert_eq!(supply, "100");
    let metadata: Value = token.view("ft_metadata").await?.json()?;
    assert_eq!(metadata["symbol"], "RULE");
    assert_eq!(metadata["decimals"], 18);
    Ok(())
}

#[test]
fn t_abi_1_wasm_exports() {
    let bytes = std::fs::read(wasm_path()).unwrap();
    let mut exports = BTreeSet::new();
    for payload in wasmparser::Parser::new(0).parse_all(&bytes) {
        if let wasmparser::Payload::ExportSection(section) = payload.unwrap() {
            for export in section {
                let export = export.unwrap();
                if export.kind == wasmparser::ExternalKind::Func {
                    exports.insert(export.name.to_owned());
                }
            }
        }
    }
    // Pin the no-ABI sandbox artifact, as built by scripts/build/sandbox-artifacts.sh.
    // Generated ABI metadata is not part of the token's application method contract.
    let expected: BTreeSet<String> = [
        "contract_source_metadata",
        "new",
        "execute_operation",
        "fund_operations",
        "get_operation",
        "get_operation_funding",
        "ft_transfer",
        "ft_transfer_call",
        "ft_total_supply",
        "ft_balance_of",
        "ft_resolve_transfer",
        "storage_deposit",
        "storage_withdraw",
        "storage_unregister",
        "storage_balance_bounds",
        "storage_balance_of",
        "ft_metadata",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(exports, expected);
}
