use base64::{Engine, engine::general_purpose::STANDARD};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::{env, fs, process::ExitCode};
use verifier_cli::{Export, Round, Row, Verification, verify_export};

fn view<T: DeserializeOwned>(
    client: &reqwest::blocking::Client,
    url: &str,
    game: &str,
    method: &str,
    args: Value,
) -> Result<T, String> {
    let encoded = STANDARD.encode(serde_json::to_vec(&args).map_err(|e| e.to_string())?);
    let response: Value = client.post(url).json(&json!({"jsonrpc":"2.0","id":"rule-verifier","method":"query","params":{"request_type":"call_function","finality":"final","account_id":game,"method_name":method,"args_base64":encoded}})).send().map_err(|e| format!("RPC request failed: {e}"))?.error_for_status().map_err(|e| format!("RPC HTTP error: {e}"))?.json().map_err(|e| format!("invalid RPC response: {e}"))?;
    if let Some(error) = response.get("error") {
        return Err(format!("RPC error: {error}"));
    }
    let bytes: Vec<u8> = serde_json::from_value(
        response
            .pointer("/result/result")
            .cloned()
            .ok_or("RPC response missing result bytes")?,
    )
    .map_err(|e| format!("invalid RPC result bytes: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid {method} result: {e}"))
}

fn fetch(url: &str, game: &str, mode: u8, id: u32) -> Result<Export, String> {
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let round: Round = view(
        &client,
        url,
        game,
        "get_round",
        json!({"mode":mode,"id":id}),
    )?;
    if round.phase != "Settled" {
        return Ok(Export {
            round,
            rows: vec![],
        });
    }
    let mut rows = Vec::new();
    while rows.len() < round.log_len as usize {
        let page: Vec<Row> = view(
            &client,
            url,
            game,
            "get_log",
            json!({"mode":mode,"id":id,"from_idx":rows.len(),"limit":200}),
        )?;
        if page.is_empty() {
            break;
        }
        if page.len() > 200 {
            return Err("RPC returned a log page larger than 200".into());
        }
        rows.extend(page);
    }
    Ok(Export { round, rows })
}

fn run() -> Result<(Verification, bool), String> {
    let mut args = env::args().skip(1);
    if args.next().as_deref() != Some("verify") {
        return Err("usage: rule verify [--from-file PATH | --network testnet --game ID --mode solo|team --round N] [--rpc-url URL] [--json]".into());
    }
    let (mut file, mut network, mut game, mut mode, mut round, mut rpc) =
        (None, None, None, None, None, None);
    let mut json_output = false;
    while let Some(arg) = args.next() {
        if arg == "--json" {
            json_output = true;
            continue;
        }
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for {arg}"))?;
        match arg.as_str() {
            "--from-file" => file = Some(value),
            "--network" => network = Some(value),
            "--game" => game = Some(value),
            "--mode" => mode = Some(value),
            "--round" => round = Some(value),
            "--rpc-url" => rpc = Some(value),
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    let export: Export = if let Some(file) = file {
        if network.is_some() || game.is_some() || mode.is_some() || round.is_some() || rpc.is_some()
        {
            return Err("--from-file cannot be combined with network options".into());
        }
        serde_json::from_slice(&fs::read(file).map_err(|e| format!("cannot read export: {e}"))?)
            .map_err(|e| format!("invalid export: {e}"))?
    } else {
        if network.as_deref() != Some("testnet") {
            return Err("--network must be testnet".into());
        }
        let game = game.ok_or("--game is required")?;
        let mode = match mode.as_deref() {
            Some("solo") => 0,
            Some("team") => 1,
            _ => return Err("--mode must be solo or team".into()),
        };
        let round: u32 = round
            .ok_or("--round is required")?
            .parse()
            .map_err(|_| "--round must be a u32")?;
        fetch(
            rpc.as_deref().unwrap_or("https://rpc.testnet.near.org"),
            &game,
            mode,
            round,
        )?
    };
    Ok((verify_export(&export), json_output))
}

fn main() -> ExitCode {
    match run() {
        Ok((result, json_output)) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::to_string(&result).expect("serializable result")
                );
            } else {
                match &result {
                    Verification::Pass { matched, total } => {
                        println!("PASS: {matched} of {total} verdicts match")
                    }
                    Verification::Fail { reason } => println!("FAIL: {reason}"),
                }
            }
            if matches!(result, Verification::Pass { .. }) {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(error) => {
            if env::args().any(|arg| arg == "--json") {
                println!("{}", json!({"status":"fail","reason":error}));
            } else {
                eprintln!("FAIL: {error}");
            }
            ExitCode::FAILURE
        }
    }
}
