# Round verifier

`rule verify --network testnet --game GAME --mode solo --round 0` reads the settled round and its log using final JSON-RPC views. Use `--rpc-url URL` to select a provider and `--json` for a machine-readable result. `rule verify --from-file round.json --json` requires no network. Exit status is zero only for PASS. Cancelled and Void rounds do not disclose a verified rule, so replay is unavailable and exits nonzero.

From the repository root in WSL:

```sh
make verify ROUND=solo/0
make verify ROUND=team/0 NEAR_RPC_URL=https://test.rpc.fastnear.com
```

The target runs the existing CLI in the `fast` profile, always selects testnet, and propagates FAIL as a nonzero make exit. `ROUND` is required; use `solo/<u32>` or `team/<u32>`. `GAME_ACCOUNT` defaults to the fresh hardened rehearsal account `game-r2.therule.testnet` and `NEAR_RPC_URL` to the public testnet RPC. It does not load `.env`, deploy, sign or fund anything. A successful replay requires that the selected round actually settled and opened. Historical r1 rounds remain available by explicitly selecting their account.

Observed testnet evidence (2026-11-07 UTC): actual default-account commands with `NEAR_RPC_URL=https://test.rpc.fastnear.com` selected `game-r2.therule.testnet`. Solo `ROUND=solo/0` printed `PASS: 52 of 52 verdicts match`; Team `ROUND=team/0` printed `PASS: 11 of 11 verdicts match`, each after a real OutLayer Solved ending. Both portable exports also passed the actual offline CLI. Keys remain retained and scheduling is compressed; this is rehearsal evidence, not a keyless launch. Earlier mock-RPC checks covered tampered-verdict failure, mode forwarding and invalid selectors. Public transaction anchors and the independent payment audits are recorded in [SMART-CONTRACT](../../docs/technical/SMART-CONTRACT.md).

The portable JSON export has `{ "round": ROUND_VIEW, "rows": [LOG_ROW, ...] }`. The round view needs `phase`, `log_len`, `rule`, `salt`, and `commit`; the verifier reads each row's `log_idx`, `seq`, `play_key`, `play`, and `verdict` and ignores other view fields. The decimal `play_key` must match the key computed from `play`. Salt and commitment are lowercase hex32, the rule and play use the shared protocol grammar. The web export shape remains provisional until the web exporter is implemented.

Logs are in callback-application order, not sequence issuance order. Indexes must be contiguous, and sequence values unique. The replay checks the commitment and the verdicts using the shared Rust crates; a PASS does not establish secrecy during the round or authenticate an RPC provider's response. Compare independently obtained sources if needed.

For the browser, build `verifier/wasm` for `wasm32-unknown-unknown`, then run `wasm-bindgen --target web` with version 0.2.130. The generated module exports `verify_round(rows_json, rule_json, salt_json, commit_json, log_len)` and `consistent(rule_json, rows_json)`; arguments and results are JSON strings. Invalid JSON throws. `consistent` checks play keys and verdicts only; it does not check completeness or a commitment.

Example from the repository root in WSL, with `wasm-bindgen-cli` 0.2.130 installed:

```sh
export CARGO_TARGET_DIR="$HOME/target-the-rule-verifier"
cargo build --manifest-path verifier/wasm/Cargo.toml --release --target wasm32-unknown-unknown --lib
wasm-bindgen --target web --out-dir verifier/wasm/pkg "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/verifier_wasm.wasm"
cargo build -p verifier-cli
```

The native/wasm smoke comparison runs on Windows Node: `node verifier/wasm/smoke.mjs /home/<user>/target-the-rule-verifier/debug/rule`. It uses WSL to run the native binary and writes a temporary export under `scratch/verifier/`.

## Cross-target golden vectors

Run `make vectors` from the repository root in WSL. Prerequisites: Rust targets `wasm32-wasip2` and `wasm32-unknown-unknown`, wasmtime, Node, wasm-bindgen CLI **0.2.130**, and the existing NEAR sandbox runtime. Put the tools on `PATH`; `WASMTIME` and `WASM_BINDGEN` may name explicit binaries. `CARGO_TARGET_DIR` selects the build cache. The script never signs, deploys to testnet, loads `.env` or installs missing tools.

The entrypoint checks 81 cases from `rule.json`, `commit.json`, `sample.json`, `referee-io.json` and `verify.json` through native Rust, WASI/wasmtime, a sandbox-only contract adapter and web-target wasm-bindgen bindings in Node. Canonical/preimage bytes, sampled rule/bucket, protocol JSON and replay results must match the fixtures. The adapter calls the production shared crates; it does not implement another evaluator. The production game's ABI is unchanged. Five replay cases additionally exercise the actual verifier web exports, including tampered verdict, duplicate sequence, missing row and play-key failures.

Observed locally on 2026-11-05: all 81 cases matched on the four script targets with wasmtime 50.0.1, wasm-bindgen 0.2.130 and Node 24.22.1. A separate throwaway smoke also passed all 81 adapter cases and all five verifier replays in a Chrome module Web Worker. That browser smoke is not part of `make vectors`; Node execution alone must not be reported as browser evidence. Neither run establishes real OutLayer execution or live RPC data authenticity.

