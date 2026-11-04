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
    let mint = |amount: &str| json!({"account_id":alice.id(),"amount":amount});
    assert_rejected(
        call(&minter, &token, "mint", mint("1"), 0).await,
        "E52: receiver not registered",
    );
    assert!(
        call(&alice, &token, "storage_deposit", json!({}), storage)
            .await
            .is_success()
    );
    assert!(
        call(&minter, &token, "mint", mint(&u128::MAX.to_string()), 0)
            .await
            .is_success()
    );
    assert_rejected(
        call(&minter, &token, "mint", mint("1"), 0).await,
        "E55: supply overflow",
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
    let mint = |id: &Account, amount: &str| json!({"account_id":id.id(),"amount":amount});
    assert_rejected(
        call(&stranger, &token, "mint", mint(&alice, "1"), 0).await,
        "E54: only minter",
    );
    assert_rejected(
        call(&minter, &token, "mint", mint(&alice, "1"), 0).await,
        "E52: receiver not registered",
    );
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
    assert_rejected(
        call(&minter, &token, "mint", mint(&alice, "0"), 0).await,
        "E11: zero mint",
    );
    assert_rejected(
        call(&minter, &token, "mint", mint(&alice, "101"), 0).await,
        "E55: cap exceeded",
    );
    assert!(
        call(&minter, &token, "mint", mint(&alice, "100"), 0)
            .await
            .is_success()
    );
    assert_rejected(
        call(&minter, &token, "mint", mint(&alice, "1"), 0).await,
        "E55: cap exceeded",
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
    let expected: BTreeSet<String> = [
        "__contract_abi",
        "contract_source_metadata",
        "new",
        "mint",
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
