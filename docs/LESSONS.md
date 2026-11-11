# THE RULE: lessons

Read the headlines before work. Record actual surprises from this project only, newest first. Each entry is `### YYYY-MM-DD: headline`, followed by bullets: what happened, the root cause with evidence, and the rule going forward. Update it in the same commit as the related behavior change.

### 2026-11-11: a rate-limited public RPC looked like a transaction failure in the browser

- **What happened:** a connected player on the Demo Stamp tab saw the setup checklist stuck on "checking…" and a card saying "Could not complete the request … the transaction outcome may be unknown", though nothing had been sent.
- **Root cause:** the Stamp tab polled about eight views every 4 s, and FastNear's anonymous limit allowed 20 parallel reads but returned HTTP 429 for a burst of 60. Its 429 carries no `Access-Control-Allow-Origin` header (checked with curl), so the browser hides the reply and `fetch` rejects with a bare `TypeError`, not a readable 429. The configured fallback `rpc.testnet.near.org` also answers 429 "endpoint is deprecated", so every read failed. The `TypeError` fell into the generic transaction-error copy.
- **Follow-up, same day:** the Meteor Wallet approval popup then failed with the same FastNear `-429`. Meteor's bundled SDK (`meteor-near-connect-latest.js`) hard-codes `https://test.rpc.fastnear.com` as its testnet node and never reads the `providers` that `NearConnector` hands it, so the page cannot redirect the wallet's RPC. The wallet's calls and the page's polling share FastNear's anonymous per-IP quota, and this machine's own load tests (bursts of 20, 60 and 40) also counted against it.
- **Rule:** never trust an RPC default without calling it from a browser origin and from a burst, and never burst a public RPC from the machine you are testing on. Poll per-account state slowly (actions already invalidate queries), skip a limiting endpoint for a cooldown, treat a bare `fetch` rejection as unreachable, and word read failures as reads. The page's primary is now `near-testnet.drpc.org` (CORS allows the origin; a burst of 50 passed on 2026-11-11) with FastNear as the fallback, so the page leaves FastNear's quota to the wallet.

### 2026-11-10: sandbox block counts are not elapsed seconds

- **What happened:** two fixture controls advanced a block count derived from seconds and failed with E50 or a control timeout; an assertion also searched receipt outcomes for a method name they never contain.
- **Root cause:** fast-forwarding blocks does not map to the contract's nanosecond deadlines, and a receipt outcome carries executor, gas and status, not the called method.
- **Rule:** advance to an observed `block_timestamp` target with a bounded loop, step adaptively, and abort when the control channel closes. Assert the observed failure cause such as `MethodNotFound`, never a method name. Check a collapsed `<details>` is open before filling its fields.

### 2026-11-10: append-only season enrollment must not discard indexing progress

- **What happened:** the focused audit found that every new season candidate reset `indexed` to zero. The added regression failed on the old code at 0 versus 2, then all 14 season cases passed after removing only that reset.
- **Root cause:** candidate-list growth and terminal score changes shared invalidation semantics despite different effects. Appending a previously unseen entity cannot change cached Settled scores; settlement can. Actual local WASM with MOCK OutLayer interleaved four paid verdicts and one-row index batches, preserved progress and exposed exactly the observed players' completed rows.
- **Rule:** preserve append progress, still increment revision/total, and reset for genuine score changes. Keep dirty boards hidden until complete. This prevents unnecessary rework, not arrivals faster than indexing or continuous settlement invalidation. Runtime checks must observe detached callbacks and derive player IDs from views, not fixture conventions.

### 2026-11-10: a scheduled slot id is not a count of retained rounds

- **What happened:** read-only Phase 6 integration found Demo's latest actual Solo round 0 but next slot 138; R3's latest was 12, next slot 34, and round 11 was absent at final block 277031784. The existing FE builds dense picker/history ids from that next slot; its Demo history window therefore excludes the round that actually exists.
- **Root cause:** skipped scheduled slots intentionally create no round record. A next-slot view describes time-based scheduling, not historical enumeration. R2's earlier dense sample did not expose this assumption.
- **Rule:** keep deployment, mode and actual round id together; never use a next-slot number as an existing-record count. Exercise sparse histories before switching FE targets, preserve the existing UI, and distinguish missing rounds from RPC errors. Read-only adapter success alone does not accept the signed/browser integration.

### 2026-11-09: a successful deployed Cron is not proof that it fits Workers Free

- **What happened:** D37's keeper started r3 Solo 0 on time and finalized it to Settled, with FINAL successful receipts and real heartbeat arrivals. Its signed finalize consumed 82 ms CPU against the documented 10-ms Free budget. D38's native signer then completed Solo 12 with signed CPU 31/28/25 ms and idle 9/12/10 ms; the dashboard independently confirmed finalize at 25 ms. The round succeeded but Free qualification still failed.
- **Root cause:** execution outcome and plan-budget compliance are separate checks; `outcome:ok` did not establish sustainable CPU headroom. [I] Completion above the published budget is consistent with the documented isolate burst flexibility, not proof that enforcement will continue allowing it. A separate start invocation threw after its successful on-chain action; its exact exception cause was not captured.
- **Rule:** record deployed signed-path CPU and receipt/state evidence before accepting a runtime. Log the public hash before the single send, reconcile unknown outcomes without resending, and keep acceptance open when the budget fails. Native crypto alone did not establish Free headroom; profile the actual engine before another authorized sample. Idle-only measurements, local profiles or startup time cannot replace deployed signing evidence. Remove Cron, pause the dedicated check and restore its normal monitoring cadence after qualification.

### 2026-11-09: a keeper ceiling does not authorize exactly one future round

- **What happened:** preparing authorized Solo 12 while the next chain slot was still 11 exposed a scope gap before enabling Cron. Both new native regressions failed: the lower bound was ignored and an older out-of-scope pending round suppressed the authorized idle heartbeat.
- **Root cause:** `LAST_ROUND_ID` is inclusive and admits every earlier id; a future ceiling cannot represent an exact-round decision. The final health check also applied only the old upper bound.
- **Rule:** apply the same inclusive lower/upper range before signing and when evaluating pending health. Reject reversed ranges before RPC. Whole-season indexing remains broader than a partially authorized round range and stays off for this qualification. All 33 local tests, actual workerd smoke and D38's exact `{mode:0,round_id:12}` transaction arguments passed afterward.

### 2026-11-09: a read-only browser suite passed while the signed paths had real bugs

- **What happened:** the v2 web app passed 39 Playwright tests against live r2 reads, yet the first wallet-signed run against a local sandbox found seven defects: `get_season` still sent the old argument shape, a disabled log query showed "Loading plays" forever, the team form suggested a name the contract rejects (E11), claim copy promised a wallet transfer while the contract credits play credit, locks were only offered for rounds the contract does not require, a fresh player could not register token storage, and a play refund could be inferred from views that had not moved yet (inferred, not reproduced).
- **Root cause:** no live round existed and no signing was authorized, so every test exercised read paths only; a green read suite says nothing about calls, finality or argument shapes. The sandbox fixture also had no token storage for the game account, so RULE locks failed until it was registered: a deployment prerequisite, not just a test detail.
- **Rule:** a feature that signs is not tested until a signer drives it against real contract code at HEAD. Run `pnpm --dir apps/web e2e:sandbox` before calling any signed web flow done, label it sandbox, never call it testnet evidence, and register the game account's storage on the token before any lock is expected to work.

### 2026-11-08: cross-platform package execution must not reconcile a shared workspace

- **What happened:** P6's Linux `pnpm exec wrangler` entered a four-package workspace dependency reconciliation instead of starting the local Worker promptly. After the stopped command, the real keeper smoke reported a missing `@noble/curves`. Offline frozen restoration repopulated 96 packages; the separate workerd build-script approval stayed unapproved. No frontend source, dependency versions or build permission was changed.
- **Root cause:** WSL resolved the Windows Corepack/pnpm shim against a shared Windows workspace and a different package-store path. A package-manager wrapper is not an isolated binary invocation.
- **Rule:** launch the installed Wrangler binary with its matching Node platform; keep temporary private config inside ignored project scratch and remove it. The actual Windows Node/workerd scheduled smoke then passed against the genuine WSL sandbox without cloud auth or a fake chain ID. Do not change workspace trust policy merely to make installation quiet.

### 2026-11-08: removing a worktree followed a node_modules junction into the real tree

- **What happened:** to typecheck each web commit, `scratch/wt-check/apps/web/node_modules` was a junction to the main `apps/web/node_modules`. `cmd //c rmdir` from Git Bash did not run (it opened a shell and exited), so `git worktree remove --force` deleted through the junction. Tracked `verifier/wasm/*` files (reached through the `@the-rule/verifier-wasm` workspace link), the web packages in the pnpm store and `verifier/wasm/pkg` were emptied. `git restore`, `pnpm install --force --frozen-lockfile` and a wasm-bindgen 0.2.130 rebuild recovered everything; the web suite (27) and keeper suite (12) passed again.
- **Root cause:** Windows junctions are followed by recursive deletes, and the removal command was never checked.
- **Rule:** before removing a worktree that has a junction, remove the junction with `os.rmdir` (it removes the link only), confirm it is gone, and confirm the target still exists. Only then run `git worktree remove`.

### 2026-11-08: vault principal is not the signing wallet's gas balance

- **What happened:** D36 funded a 3-NEAR Team vault, but a member with 0.149085480732098956410234 NEAR in its wallet had a signed 300-Tgas play rejected against a 0.300919159630831-NEAR transaction-cost quote. The nonce had not advanced. The already-planned low-gas E30 roster guard then consumed that exact nonce before parent gas sponsorship of 0.4/0.1 NEAR; the original signed play was never resent.
- **Root cause:** vault/credit funding and expected burnt fees do not establish the wallet liquidity needed for protocol transaction admission. A future top-up must not accidentally make an old rejected signed transaction usable.
- **Rule:** budget wallet gas separately from Team principal and preserve headroom after deposits. Distinguish a signed validation rejection from an unsigned lookup error; retain the original evidence and verify an appropriate nonce fence before funding. This is transaction-admission fencing, not recovery of an unknown native payment.

### 2026-11-08: a missing CLI hash is not evidence that nothing was sent

- **What happened:** D36's first paid play was FINAL while a later snapshot hit public RPC 429s. Two attempts failed before signing; another was signed but validation-rejected. The E30 roster call executed, but near-cli-rs 0.30.1 printed its error before the id; a read-only shard search recovered it. Later, `--wait-until none` returned a claim hash that never appeared on chain. The installed NEAR serializer reconstructed its exact nonce/hash; a same-key, same-nonce FINAL getter with unchanged game credit excluded the original claim before a replacement.
- **Root cause:** submission acknowledgement, validation, inclusion and execution are different milestones. [`NONE` returns before node validation](https://docs.near.org/api/rpc/transactions#the-wait_until-field); it is not admission. Repeated snapshots also caused unnecessary RPC bursts, and a provider's extra JSON-RPC `note` was incompatible with the real CLI parser.
- **Rule:** qualify the actual client, pace reads and reuse genuinely observed snapshots. Persist the signed payload/hash before broadcasting when possible; require inclusion, then FINAL and complete receipts. A missing hash or a fire-and-forget acknowledgement never permits a blind resend. A nonce fence must prove the exact original identity and exclude its execution; it cannot restore an unknown native payment.

### 2026-11-07: context-stalled inference needs a reachable experiment, not another blind guess

- **What happened:** D35 reached 50 real plays but retained four non-equivalent, log-consistent candidates and only three remaining guesses. A common-YES line reset followed by an actual short-gap play reduced the set; the next semantic guess checked Correct. The round ultimately opened and replayed 52/52.
- **Root cause:** all three prior YES lines had made a contextual predicate observationally redundant. Exhausting number/word inputs at one current context cannot distinguish rules that differ only in previous-number or gap context.
- **Rule:** use the shared evaluator/equivalence engine, inspect reachable contexts and remaining budgets before signing, and retain actual inclusion context as authoritative. Spend a legal context-changing experiment rather than call one consistent rule proven. Temporary diagnostics must have no signing or secret-rule access and be removed after use.

### 2026-11-07: pending duplicates require the same full play context

- **What happened:** the exact-artifact sandbox round test expected E12 from repeated number/word but received E13 across a minute boundary. The live r2 operator also observed a real inclusion minute differing from its prior advice.
- **Root cause:** the shared play key includes minute digit and previous-YES context, not just number and word. Different contextual keys correctly reach the entity-pending guard instead of the pending-key guard.
- **Rule:** test E12/E13 precedence with a controlled clock: same-minute duplicate E12, next-minute E13, and the matching digit ten minutes later E12, all without state or receipt effects. The native regression and actual-WASM round scenario passed; the wall-clock-dependent assertion was removed, not weakened to accept either error. Live inference must consume the actual logged context and never resend a settled play because its advice context drifted.

### 2026-11-07: native-payment incidents need receipt dependencies, not transaction success

- **What happened:** the new read-only diagnostic matched the real D32 withdrawal and platform receipts, while focused regressions preserved a successful transfer alongside a failed callback and kept partial evidence unknown.
- **Root cause:** an initiating transaction's success does not establish the result of detached transfer and callback receipts. An unrelated or missing completion cannot authenticate a payment outcome.
- **Rule:** retain the original transaction hash and raw public RPC responses; bind the transfer and callback through their promise-data dependency and check identity, recipient and amount. Diagnose transfer, callback and RPC failures separately. Never turn a diagnostic log into authority to refund or resend an unknown native effect.

### 2026-11-06: payment uncertainty must not own the gameplay lock

- **What happened:** a native regression reproduced E13 for a funded play during withdrawal. After guard separation, actual sandbox WASM paid 0.25 NEAR while its deliberately masked callback failed `MethodNotFound`; later failed/NO experiments still refunded or settled, while payment principal remained reserved.
- **Root cause:** one `Player.pending` boolean let two unrelated async completion paths own the same admission flag. Reusing remaining credit is independent of establishing a historical native-transfer result.
- **Rule:** give each operation its own guard and consume matching request ids once; test callback order, withheld/duplicate/late results and credit boundaries. Isolation is not recovery. Never infer refund authority from a callback failure or RPC log; keep the native proof/risk gate open before key deletion.

### 2026-11-06: a consistent hypothesis is not a correct rule

- **What happened:** the real D32 rehearsal reached 22 plays, then four guesses all checked Wrong. The operator still reported 37 consistent canonical candidates before the first inferred guess. The actual opened rule was `AND(NOT atom 46, NOT atom 70)`; dropping the word-group exclusion fit those observations but was not equivalent. The ordinary Unsolved round then opened and replayed PASS 22/22; both native withdrawals and platform payout completed.
- **Root cause:** a limited adaptive sample did not identify one semantic equivalence class. RPC timeout/429 and redundant local equivalence work consumed the compressed investigation window; these are distinct from contract callback failures, of which none was observed.
- **Rule:** qualify inference/observation tooling before the paid run, reserve enough real schedule headroom, and do not treat “fits the log” as “equivalent”. Respect authorized guess ceilings even when no solve is obtained. Preserve a truthful Unsolved outcome and leave correct-winner acceptance open rather than inject an answer, silently extend limits or claim callback recovery from successful receipts.

### 2026-11-06: offline command generation does not qualify CLI units

- **What happened:** the first token deploy command was rejected by near-cli-rs 0.30.1 with `Incorrect unit: 100000000000000 gas`, before signing or broadcast. Both newly created accounts remained funded; the token still had no code at final block 276482085.
- **Root cause:** the planner emitted raw gas with an unsupported unit. Offline generation and boundary tests did not execute the real CLI parser.
- **Rule:** convert gas exactly to decimal Tgas, preserve integer precision and smoke the actual command path. Corrected token/game deployments succeeded without repeating account creation; deployed bytes and live parameters matched the reviewed plan. An unsigned parser rejection is distinct from an unknown on-chain outcome.

### 2026-11-06: an unknown external effect needs an atomic replay fence

- **What happened:** actual local token mint/unlock effects succeeded while deliberately masked game callback exports failed `MethodNotFound`. Restoring the local artifact and overlapping same-id replays reconciled once without duplicate supply, custody release or storage charge (`scratch/recovery-runtime.log`).
- **Root cause:** failed callback transport does not reveal whether its preceding effect committed. Timeout restoration would mistake a completed effect for failure.
- **Rule:** atomically persist an immutable operation outcome with the effect, fund its permanent storage explicitly, and accept only a bounded exact acknowledgement. Reuse the same id for recovery; never infer failure from time or current balance. Native NEAR transfer recovery remains separate because it has no such outcome interface.

### 2026-11-06: returned transfer principal is not free operator collateral

- **What happened:** the native `refunded_native_principal_is_not_operator_collateral_before_callback` model admitted another round using returned withdrawal principal before its failed callback (`scratch/b6-native-reserve-before.log`). This modeled refund-first ordering is not an observed sandbox scheduling failure.
- **Root cause:** withdrawal/platform initiation removes the original obligation, but a failure refund can return before the matching callback restores it. Subtracting only current ledger obligations overstates operator availability in that interval.
- **Rule:** reserve pending native principal until matching completion, fence duplicates, and accept conservative admission rejection while principal is escrowed or paid. Native withdrawal/platform ordering regressions now pass; this reservation is not unknown-outcome recovery.

### 2026-11-05: do not mix new Team capital with impaired depositor weights

- **What happened:** the local regression `new_capital_cannot_subsidize_previous_round_losses` failed before the fix because a new deposit was accepted instead of E30 after a Team vault loss (`scratch/b6-team-dilution-before.log`). The fixture's 40,000-yocto original position had a 29,900-yocto vault after settlement.
- **Root cause:** vault withdrawals use nominal depositor weights to divide the remaining vault pro rata. Adding fresh capital at nominal weight while the vault is below total weight makes the new depositor share prior losses.
- **Rule:** reject new deposits with E30 while `vault != total_weight`; close old positions to credit before a fresh deposit epoch. The local native regression subsequently passed, and the actual-WASM Team runtime exercised the policy with MOCK OutLayer; this is not testnet evidence.

### 2026-11-05: match callback ownership before consuming a shared request

- **What happened:** native dispatch regressions reproduced a wrong private callback deleting another request: referee admission remained stuck at one and an expected platform restoration stayed zero. The corrected matrix passes for referee completion/expiry and all five token/payment request kinds.
- **Root cause:** destructuring `pending.remove(id)` consumed the entry before discovering that its enum variant belonged to another callback. A callback's private annotation does not establish ownership of the supplied id.
- **Rule:** check the expected request kind before removal, then consume exactly once. Exercise the correct completion, expiry where safe, duplicates and replacements after wrong dispatch. Read-only registration may expire without money effects; unknown transfer/mint outcomes still must not be blindly refunded.

### 2026-11-05: caller binding belongs to the manifest section, not a byte-count heuristic

- **What happened:** the rehearsal planner rejected the actual committed referee even though its caller was correct. Its manifest JSON appeared twice: once in program data and once in `outlayer.manifest`.
- **Root cause:** raw-byte occurrence count confused compiler-retained data with the authoritative custom section. Pinned wasm-tools showed one manifest section; the old planner required one text occurrence.
- **Rule:** parse bounded module/component sections and require exactly one caller-bound manifest section. Reject missing/duplicate/truncated sections, then independently validate the full artifact and audit imports. The corrected offline CLI and four boundary regressions passed; no deployment occurred.

### 2026-11-05: initiating transaction completion is not detached callback completion

- **What happened:** the first capacity sandbox run read nine pending referee requests immediately after awaiting a resolved begin transaction and expected eight. Waiting for the callback's state transition made the full saturation/refund/reveal runtime pass.
- **Root cause:** game `execute` detaches its promise chain. The initiating transaction can complete before the later callback updates game state; a resolved mock yield does not itself establish callback completion.
- **Rule:** resolve the observed dependency, then wait for the specific callback-state transition before checking its effects. Bound the observation wait and fail if the transition never occurs; never resend the operation or weaken the assertion.

### 2026-11-05: matching artifact hashes do not establish Docker provenance

- **What happened:** a successful cargo-near Docker build reported a new game hash inside the container, but its host output matched the old local artifact. The actual sandbox metadata view returned null `build_info`; the requested-source smoke failed.
- **Root cause [V, locally exercised]:** an inherited host `CARGO_TARGET_DIR` directed artifact selection to the local cache after the container build. Unsetting it for the reproducible subprocess produced both actual metadata views with the requested commit, pinned image and correct contract paths.
- **Rule:** compare independent builds and require their actual NEP-330 metadata to match the requested source revision, image and contract path. Never label matching stale cache bytes reproducible evidence.

### 2026-11-05: resolve yielded dependencies before awaiting transaction completion

- **What happened:** the first extended storage run reached finalize and was cancelled while waiting before the mock open was resolved. The corrected executable completed settlement and the next round. On 2026-11-06, the full workspace run exposed the same ordering in the solved Solo test; the corresponding Team path had the same pattern. Both now use one dependency-first helper, and all six guess/Team runtime tests passed (`scratch/recovery-lifecycle.log`).
- **Root cause:** awaiting transaction completion before supplying a yielded descendant's result blocks the harness. `TransactionStatus` implements `IntoFuture`, not `Future`, so it must be converted before use with `tokio::select!`.
- **Rule:** race the completion future with the expected mock request, resolve that observed request once, then await completion. Only the expected pre-deadline E50 rejection permits another finalize attempt; check every sibling harness and never call a cancelled run passing evidence.

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

- **What happened:** the earlier gas-1 upload's probe URL returned 404 for about 20 minutes. On 2026-11-06 a separately authorized production upload worked: public GET returned exact bytes while HEAD returned 404. The CLI still omitted its tx hash on expected action failure; access-key nonce/block changes located tx `3XbgZYVddhofieFctrvz154P1zUY5TbsDFkLVgEF6bru`, and final transaction RPC established its cost.
- **Root cause:** the historical probe failure remains unknown [U]; the later method discrepancy is observed, not a diagnosis of the old failure. Intentional upload action failure alone does not establish availability.
- **Rule:** verify downloaded GET bytes and hash, not only HEAD or transaction status. Keep independent Cloudflare/FastFS origins, recover exact receipt evidence before resending, and never repeat an upload merely because the CLI reports its expected gas failure. D28 hosting is now published; real worker execution remains P2.9.

### 2026-11-04: near CLI wrote THE RULE's key into another project's credentials folder

- **What happened:** `near account create-account ... save-to-legacy-keychain` saved the `therule.testnet` key under the CONSTITUTION project's `.secrets/near-credentials/`.
- **Root cause:** the WSL near-cli-rs config (`~/.config/near-cli/config.toml`) is shared, and its `credentials_home_dir` already pointed at that project. Evidence: the CLI printed the path after the create call.
- **Rule:** before the first key-writing command read `credentials_home_dir`. THE RULE uses only the `near-rule` wrapper (own `XDG_CONFIG_HOME`, credentials in `~/.near-credentials-the-rule`, mode 600). The two stray files were moved out and the other project's own entries were left unchanged.
