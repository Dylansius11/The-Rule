# Round verifier

`rule verify --network testnet --game GAME --mode solo --round 0` reads the settled round and its log using final JSON-RPC views. Use `--rpc-url URL` to select a provider and `--json` for a machine-readable result. `rule verify --from-file round.json --json` requires no network. Exit status is zero only for PASS. Cancelled and Void rounds do not disclose a verified rule, so replay is unavailable and exits nonzero.

From the repository root in WSL:

```sh
make verify ROUND=solo/0
make verify ROUND=team/0 GAME_ACCOUNT=game-r1.therule.testnet NEAR_RPC_URL=https://rpc.testnet.near.org
```

The target runs the existing CLI in the `fast` profile, always selects testnet, and propagates FAIL as a nonzero make exit. `ROUND` is required; use `solo/<u32>` or `team/<u32>`. `GAME_ACCOUNT` defaults to the planned rehearsal account `game-r1.therule.testnet` and `NEAR_RPC_URL` to the public testnet RPC. It does not load `.env`, deploy, sign or fund anything. A successful real-round replay still requires that the selected account and settled round actually exist; the default address is not a deployment claim.

Local evidence (2026-11-05): the actual make target returned PASS on the existing four-row golden export served by a mock RPC, returned nonzero for its tampered-verdict vector, forwarded both mode selectors, and rejected missing/invalid selectors before RPC. The real referee testnet rehearsal remains P2.9.

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
