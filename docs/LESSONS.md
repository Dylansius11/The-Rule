# THE RULE: lessons

Read the headlines before work. Record actual surprises from this project only, newest first. Each entry is `### YYYY-MM-DD: headline`, followed by bullets: what happened, the root cause with evidence, and the rule going forward. Update it in the same commit as the related behavior change.

### 2026-11-05: a pending play flag does not cover Checking guesses

- **What happened:** the new withdrawal regression failed because `withdraw_credit` succeeded while two guesses were Checking; the specification requires E21. The three credit tests passed after the fix, and the sandbox gas flow observed E21 with unchanged credit during a check and successful withdrawal afterward.
- **Root cause:** guesses incremented the round's `pending_checks`, but withdrawal read only `Player.pending`, shared by plays and transfers. That flag did not represent live guesses.
- **Rule:** track player-level Checking count independently. Release one count per consumed request for every result, including expiry; duplicates cannot release another check. A mocked oversized balance is not live-balance proof: retain the meaningful money-conservation property, not an assertion against a static VM balance.

### 2026-11-05: zero gas and fast-forward height are not callback-timeout evidence

- **What happened:** zero callback gas made the sandbox reject the initiating receipt with `FunctionCallZeroAttachedGas`. With a 1-Tgas callback, the play remained pending, but forwarding 1,200 heights did not cross its ten-minute wall-clock deadline and recovery still rejected E50.
- **Root cause:** an invalid receipt never creates the intended stalled operation; height advancement was not sufficient evidence of elapsed timestamp time in this sandbox run.
- **Rule:** distinguish each fault. The successful local smoke used positive starved callback gas and an explicitly patched request deadline, then verified full one-time refund and withdrawal. Native tests cover the exact ten-minute boundary; never describe the patched smoke as ten elapsed minutes or testnet evidence.

### 2026-11-05: token registration refunds cannot identify a new registration

- **What happened:** the pre-freeze regression showed an already-registered token user losing 1,000 yocto of game credit (`998900` instead of `999900`) when game-funded `storage_deposit` succeeded.
- **Root cause:** NEP-145 returns a successful storage balance for both new and existing accounts; an existing registration refunds the attached deposit to the predecessor, not the player whose game credit was debited. A preliminary check would still race with external registration.
- **Rule:** players pay token storage directly. The game only checks `storage_balance_of` with zero attached NEAR, parses its response strictly, and never moves registration money through game credit.

### 2026-11-05: unit fixtures must separate logical receipt gas

- **What happened:** after raising callback budgets, the two-reveal ordering test failed with `HostError(GasExceeded)` before applying either result.
- **Root cause:** two logical reveal receipts each scheduled 100 + 60 Tgas but shared one 300 Tgas mocked environment. The contract configuration was not the cause.
- **Rule:** reset the mocked environment before each reveal helper invocation, preserving block/time and persistent storage. Do not inflate gas or weaken the out-of-order callback assertions to hide fixture errors.

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
