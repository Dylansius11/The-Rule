# THE RULE: lessons

Read the headlines before work. Record actual surprises from this project only, newest first. Each entry is `### YYYY-MM-DD: headline`, followed by bullets: what happened, the root cause with evidence, and the rule going forward. Update it in the same commit as the related behavior change.

### 2026-11-05: matching artifact hashes do not establish Docker provenance

- **What happened:** a successful cargo-near Docker build reported a new game hash inside the container, but its host output matched the old local artifact. The actual sandbox metadata view returned null `build_info`; the requested-source smoke failed.
- **Root cause [V, locally exercised]:** an inherited host `CARGO_TARGET_DIR` directed artifact selection to the local cache after the container build. Unsetting it for the reproducible subprocess produced both actual metadata views with the requested commit, pinned image and correct contract paths.
- **Rule:** compare independent builds and require their actual NEP-330 metadata to match the requested source revision, image and contract path. Never label matching stale cache bytes reproducible evidence.

### 2026-11-05: resolve yielded dependencies before awaiting transaction completion

- **What happened:** the first extended storage run reached finalize and was cancelled while waiting before the mock open was resolved. The corrected executable completed settlement and the next round.
- **Root cause [I]:** awaiting transaction completion before supplying a yielded descendant's result can block the harness. `TransactionStatus` implements `IntoFuture`, not `Future`, so it must be converted before use with `tokio::select!`.
- **Rule:** race the completion future with the expected mock request, resolve the observed request once, then await completion. Only the expected pre-deadline E50 rejection permits another finalize attempt; do not call a cancelled run passing evidence.

### 2026-11-05: balance observations need one block and receipt-defined principal

- **What happened:** the first balance harness mixed optimistic contract views with final account queries, then failed its mock-deposit check against a stale account balance. After block pinning, its withdrawal net-bound check failed because refunds from earlier signer transactions arrived during the observation window.
- **Root cause:** observations at different blocks do not describe one accounting state, and a signer's net balance movement includes more than the current transfer principal.
- **Rule:** pin ledger and account queries to the same block and require agreement. Verify gross principal and success on actual transfer receipts; keep signer gas/refunds separate. The corrected sandbox exercised failed platform payment, restored accrual and an exact-principal retry.

### 2026-11-05: refund cleanup must preserve state owned by overlapping operations

- **What happened:** three new regressions failed: an overlapping correct stake had claimable 0 instead of 100, a wrong stake's Void refund had 0 instead of 50, and first-play expiry bypassed E15. All three passed after the fix; the local sandbox also preserved the commit cap and claimed the overlapping stake.
- **Root cause:** first-play refund removed an entity when its play counters were empty, ignoring that guesses shared the same entity record. Global ledger conservation alone did not expose the orphaned per-player entitlement.
- **Rule:** remove shared records only when every owning operation and entitlement is empty. Reconcile aggregate stakes/claimables against per-account claims, not just the sum of ledger fields.

### 2026-11-05: a pending play flag does not cover Checking guesses

- **What happened:** the new withdrawal regression failed because `withdraw_credit` succeeded while two guesses were Checking; the specification requires E21. The three credit tests passed after the fix, and the sandbox gas flow observed E21 with unchanged credit during a check and successful withdrawal afterward.
- **Root cause:** guesses incremented the round's `pending_checks`, but withdrawal read only `Player.pending`, shared by plays and transfers. That flag did not represent live guesses.
- **Rule:** track player-level Checking count independently. Release one count per consumed request for every result, including expiry; duplicates cannot release another check. A mocked oversized balance is not live-balance proof: retain the meaningful money-conservation property, not an assertion against a static VM balance.

### 2026-11-05: zero gas and fast-forward height are not callback-timeout evidence

- **What happened:** zero callback gas made the sandbox reject the initiating receipt with `FunctionCallZeroAttachedGas`. With a 1-Tgas callback, the play remained pending, but forwarding 1,200 heights did not cross its ten-minute wall-clock deadline and recovery still rejected E50.
- **Root cause:** an invalid receipt never creates the intended stalled operation; height advancement was not sufficient evidence of elapsed timestamp time in this sandbox run.
- **Rule:** distinguish each fault. The successful local smoke used positive starved callback gas and an explicitly patched request deadline, then verified full one-time refund and withdrawal. Native tests cover the exact ten-minute boundary; never describe the patched smoke as ten elapsed minutes or testnet evidence.

### 2026-11-05: sandbox storage charges must be checked against retained growth

- **What happened:** the storage executable failed seven checks with the old 100-byte allowances. A 64-character player used 135 bytes and the first settled YES plus entity used 472. Re-running with the existing production allowances of 160/768 bytes covered all sampled retained growth; production defaults were not raised.
- **Root cause:** the sandbox fixture's small round numbers exercised state transitions without funding the state they retained. Large sandbox account balances masked the shortfall.
- **Rule:** check actual storage deltas against charges, test maximum legal account length, and separate retained charges from transient/operator liquidity. Samples are not worst-case concurrency bounds or a deploy budget.

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
