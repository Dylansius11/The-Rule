# THE RULE: lessons

Read the headlines before work. Record actual surprises from this project only, newest first. Each entry is `### YYYY-MM-DD: headline`, followed by bullets: what happened, the root cause with evidence, and the rule going forward. Update it in the same commit as the related behavior change.

### 2026-11-04: worker checks missed lints and a hidden build prerequisite

- **What happened:** the lead's integrated run found four clippy errors in `crates/rule-core/tests/equiv_brute.rs` and three token sandbox tests failing on a missing wasm file, although each worker reported green.
- **Root cause:** workers ran `cargo clippy` without `--all-targets`, and the token sandbox tests read `$CARGO_TARGET_DIR/near/token/token.wasm`, which exists only after `cargo near build`. Evidence: lead run of `cargo clippy -p rule-core --all-targets -- -D warnings` and `cargo test -p token`.
- **Rule:** the acceptance command is `cargo clippy --all-targets -- -D warnings`; any test that needs a built artifact must say so in its failure message and in the task note (build with `XDG_CONFIG_HOME=$HOME/.config-the-rule cargo near build ...`).

### 2026-11-04: FastFS testnet upload did not serve the file

- **What happened:** the documented FastFS upload (a deliberately failing 1-gas transaction read by an indexer) was sent, but `https://test.fastfs.io/<signer>/outlayer.testnet/<sha256>.wasm` returned HTTP 404 on every check over about 20 minutes.
- **Root cause:** unknown [U]. The CLI printed no transaction hash and the indexer is outside our control.
- **Rule:** never depend on FastFS alone. Probes ran through a Cloudflare quick tunnel (OutLayer fetched and hash-checked the bytes). Production hosting is open decision D28.

### 2026-11-04: near CLI wrote THE RULE's key into another project's credentials folder

- **What happened:** `near account create-account ... save-to-legacy-keychain` saved the `therule.testnet` key under the CONSTITUTION project's `.secrets/near-credentials/`.
- **Root cause:** the WSL near-cli-rs config (`~/.config/near-cli/config.toml`) is shared, and its `credentials_home_dir` already pointed at that project. Evidence: the CLI printed the path after the create call.
- **Rule:** before the first key-writing command read `credentials_home_dir`. THE RULE uses only the `near-rule` wrapper (own `XDG_CONFIG_HOME`, credentials in `~/.near-credentials-the-rule`, mode 600). The two stray files were moved out and the other project's own entries were left unchanged.
