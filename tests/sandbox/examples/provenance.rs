//! Exercise NEP-330 on actual reproducible wasm in an isolated sandbox, without initialization.
//! A matching pair of stale local artifacts is not sufficient build provenance.
use sandbox_tests::artifact;
use serde_json::Value;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let revision = std::env::var("EXPECTED_SOURCE_REV")?;
    if revision.len() != 40 || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("EXPECTED_SOURCE_REV must be the full source commit id".into());
    }
    let expected_source = format!("git+https://github.com/Dylansius11/the-rule?rev={revision}");
    let expected_environment = "sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234";
    let worker = near_workspaces::sandbox().await?;
    for name in ["game", "token"] {
        let path = artifact(name);
        let contract = worker.dev_deploy(&std::fs::read(&path)?).await?;
        let metadata: Value = contract.view("contract_source_metadata").await?.json()?;
        println!("{name}: {}\n{metadata}", path.display());
        let info = &metadata["build_info"];
        if info["source_code_snapshot"] != expected_source
            || info["build_environment"] != expected_environment
            || info["contract_path"] != format!("contracts/{name}")
        {
            return Err(format!("{name}: build provenance does not match the requested source, pinned image and contract path").into());
        }
        let command = info["build_command"]
            .as_array()
            .ok_or("missing build command")?;
        if !command.iter().map(Value::as_str).eq([
            "cargo",
            "near",
            "build",
            "non-reproducible-wasm",
            "--locked",
            "--no-abi",
        ]
        .into_iter()
        .map(Some))
        {
            return Err(format!("{name}: unexpected container build command").into());
        }
    }
    println!(
        "PASS: both wasm metadata views match source {revision} and the pinned reproducible recipe"
    );
    Ok(())
}
