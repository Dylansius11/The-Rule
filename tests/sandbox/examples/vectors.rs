//! Exercise shared fixture computations in a sandbox-only NEAR wasm contract.
use serde_json::{Value, json};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let wasm = std::env::var_os("VECTOR_ADAPTER_WASM")
        .ok_or("VECTOR_ADAPTER_WASM must name the built sandbox adapter")?;
    let path =
        std::env::var_os("VECTOR_CASES").ok_or("VECTOR_CASES must name the fixture cases")?;
    let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(path)?)?;
    assert!(!cases.is_empty(), "empty vector fixture");
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&std::fs::read(wasm)?).await?;
    for (index, case) in cases.iter().enumerate() {
        let actual: Value = contract
            .view("run")
            .args_json(json!({"kind":case["kind"], "input":case["input"]}))
            .await?
            .json()?;
        assert_eq!(actual, case["expected"], "sandbox vector {index}");
    }
    println!("sandbox: {} golden vectors matched", cases.len());
    Ok(())
}
