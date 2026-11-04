# Referee build notes

Set `RULE_GAME_ACCOUNT` to the exact testnet game account when building the WASI guest; it is embedded in the OutLayer manifest and changes the wasm hash and bound key. `scripts/referee/audit-imports.sh` builds and audits production and Demo Mode - preselected rule artifacts. The `demo` feature alone reads `RULE_DEMO`, a fair canonical-rule JSON object supplied as an OutLayer secret. It is disabled in production.

The production component imports `wasi:cli/environment` through the Rust WASI standard-library runtime, even though referee production code has no environment-reading path. The audit asserts the production bytes do not contain `RULE_DEMO` and the demo bytes do. This string check is not a proof that the runtime never accesses the environment.

The component test uses a test-only stub MAC (`SHA256("test-only-stub-key" || data)`), not the OutLayer host or a real key. Composed artifacts are local test artifacts, not deployable referee builds.
