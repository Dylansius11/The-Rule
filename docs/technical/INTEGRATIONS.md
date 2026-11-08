# THE RULE: integrations and setup

## TL;DR

- **Exercised (2026-11-04):** testnet accounts and funding, the deployed Phase 0 probe, OutLayer T1 to T3 and failure/latency probes, temporary HTTPS hosting; receipts are in SMART-CONTRACT. Local sandbox game/token tests use MOCK OutLayer and are not testnet evidence.
- **Referee hosting exercised (2026-11-06):** founder-authorized Cloudflare Pages primary and FastFS testnet mirror serve identical reviewed production bytes; no card, paid plan or public GitHub repository. Full URLs/hash and upload receipt: REPRODUCIBLE-BUILDS.
- **Not yet exercised / founder gates:** deployed keeper, web wallet signing and NEAR Auth; publish source and submit at P8.6/P8.7. Design references (B1) were given on 2026-11-08. Founder restored Docker 28.5.1 in Windows and WSL on 2026-11-06; current contract builds remain separate evidence.
- **Skills:** five project skills installed into `.claude/skills/` with `skills-lock.json`; two skipped. Restore recipe below.

## Integration inventory

| Integration | Purpose | Owner | Manual / automatic | Access or cost gate | Status and source |
| --- | --- | --- | --- | --- | --- |
| OutLayer (`outlayer.testnet`) | TEE referee execution | Lead | Automatic (contract calls) | Testnet NEAR per execution, paid by the game's compute float | Phase 0 probe exercised [V] 2026-11-04; real referee remains P2.9 |
| NEAR testnet RPC | Views, transactions | Lead | Automatic | Free public endpoints; rate limits unpublished | Views and probe transactions exercised [V] 2026-11-04 |
| Testnet accounts + faucet | Parent and sub-accounts, funding | Lead creates, founder funds | Manual funding | Faucet availability | Accounts created [V] 2026-11-04; additional funding B2 |
| Cloudflare Pages + FastFS testnet mirror | Public hash-pinned referee bytes for `WasmUrl` | Lead | Pages Direct Upload + NEAR upload | Founder authorized publication; FastFS ceiling 0.002 testnet NEAR | Both public GETs matched on 2026-11-06; D28/P2.2 satisfied, real worker execution P2.9 |
| NEAR Connect wallet | P0 sign-in and signing in the web app | Lead (Phase 7) | Automatic | None | Documented [V] |
| Cloudflare Pages | Referee asset hosting now; static game web later | Founder account, lead deploys | Direct Upload | Free static hosting; no card/paid service activated | Referee project `the-rule-referee` deployed 2026-11-06; web remains Phase 7 |
| Keeper runtime (Cloudflare Workers Cron, fallback GitHub Actions) | Permissionless transitions | Lead | Automatic | Free tier; signing qualification B5 | Local workerd signing qualified (B5); deployed/runtime rehearsal still P6.2 |
| Healthchecks.io | Keeper heartbeat alert | Founder account | Manual account | Free Hobbyist | Documented [V] |
| GitHub | Source repo, CI, candidate public artifact mirror | Founder | Source remote/push authorized 2026-11-05; work on `dev`, PR into `main` | None | `Dylansius11/The-Rule` exists and reports PRIVATE; visibility and artifact publication remain separate D28/P8.6 work |
| NEAR Auth (P1) | Passkey sign-in | Lead | Automatic | SDK depends on near-api-js 4/5 (B4) | Documented [V]; P1 only |

## Step-by-step recipes

Every command below is **planned, not run**, unless it shows an observed result. Run from the repo root in WSL unless stated. Nothing here is done before the founder's go (B3).

### 1. Testnet accounts and faucet (P0.2, D21)

1. **Prerequisites:** near CLI `near-cli-rs` 0.30.1 ([GitHub release v0.30.1](https://api.github.com/repos/near/near-cli-rs/releases/latest), npm `near-cli-rs` 0.30.1, checked 2026-11-04). Docs: [create account](https://docs.near.org/getting-started/create-account.md), [faucet](https://docs.near.org/getting-started/faucet.md).
2. **Agent steps (lead, after go):**
   - Use only the `near-rule` wrapper (`XDG_CONFIG_HOME=~/.config-the-rule near ...`, credentials in `~/.near-credentials-the-rule`) so keys never land in another project's folder (LESSONS 2026-11-04). Install: the near-cli-rs v0.30.1 release tarball for `x86_64-unknown-linux-gnu`, sha256 checked against the release `.sha256` file.
   - Parent: `near-rule account create-account sponsor-by-faucet-service therule.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`. Observed 2026-11-04: account created with 10 NEAR, tx `3YMHT4Sv91uA4MPTHkrPum67a4Kwo6STBLpYfVtcSfES`. Sub-accounts: `near-rule account create-account fund-myself <name>.therule.testnet '<amount> NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as therule.testnet network-config testnet sign-with-legacy-keychain send` (observed working for `probe-other`, `probe-game`, `keeper`). Later: `game-r1`, `token-r1`, `demo-game`, `demo-token`, `platform`, `game`, `token`.
3. **Human steps (founder):** after the lead sends `therule.testnet`, open the [NEAR faucet](https://docs.near.org/getting-started/faucet.md), enter that account, request testnet NEAR. Repeat if more is needed. Never paste a private key into chat.
4. **Environment variables** (`.env`, gitignored; names only in `.env.example`):

   | Name | Consumer | Secret |
   | --- | --- | --- |
   | `NEAR_NETWORK` | scripts, keeper | public (`testnet`) |
   | `NEAR_RPC_URL`, `NEAR_RPC_FALLBACK_URL` | scripts, keeper, verifier | public |
   | `THERULE_PARENT_ACCOUNT` | scripts | public |
   | `GAME_ACCOUNT`, `TOKEN_ACCOUNT`, `DEMO_GAME_ACCOUNT`, `DEMO_TOKEN_ACCOUNT`, `PLATFORM_ACCOUNT`, `KEEPER_ACCOUNT` | scripts, keeper, web build | public |
   | `KEEPER_PRIVATE_KEY` | keeper secret store only | **secret** |
   | `HEALTHCHECK_PING_URL` | keeper | **secret** (unguessable URL) |

   Operator keys for the parent and rehearsal accounts stay in the credentials home outside the repo (mode 600), not in `.env`. The keeper key is the only private key in `.env`.
5. **Verification:** `curl -s $NEAR_RPC_URL -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"therule.testnet"}}'`. Expected: a result with `amount` greater than 0. Before P0.2 the observed result was `UNKNOWN_ACCOUNT` (block 276191846, 2026-11-04).
6. **Evidence:** account creation tx hashes in SMART-CONTRACT "Deployment".

### 2. OutLayer referee execution (P0.4 to P0.8, P2)

1. **Docs [V] 2026-11-04:** [near-integration](https://app.outlayer.ai/docs/near-integration), [encryption-keys](https://app.outlayer.ai/docs/encryption-keys), [manifest](https://raw.githubusercontent.com/out-layer/outlayer/main/wasi-examples/CONNECTOR_MANIFEST.md), [WIT](https://raw.githubusercontent.com/out-layer/outlayer/main/worker/wit/deps/encryption-keys.wit), [trust](https://app.outlayer.ai/docs/trust-verification), [attestation](https://app.outlayer.ai/docs/tee-attestation). SDK: outlayer 0.2.1.
2. **Human steps:** none. No OutLayer account, API key or payment key is used; the game contract pays in NEAR.
3. **Agent steps:**
   - Build: `cargo build -p referee --release --target wasm32-wasip2` (P0.4 probe uses `spikes/probe-referee`).
   - Audit imports: `wasm-tools component wit target/wasm32-wasip2/release/referee.wasm > enclave/referee/IMPORTS.txt`.
   - Quote the cost: view `estimate_execution_cost` with the chosen `resource_limits`; set `outlayer_deposit` to that value plus 20%.
   - Call from the contract only; never `request_execution` from a personal account except in T2, where refusal is the expected result.
4. **Environment variables:** `OUTLAYER_ACCOUNT` (public, `outlayer.testnet`), `REFEREE_URL_PRIMARY`, `REFEREE_URL_MIRROR`, `REFEREE_SHA256` (public; compiled into game init args).
5. **Verification (read-only, observed 2026-11-04):**
   - `get_max_limits({})` returned `[500000000000,180,300]` (instructions, execution s, compile s) at block 276188426.
   - `get_pricing({})` returned base `1e21` yocto (0.001 NEAR), `1e14` yocto per million instructions, `1e17` yocto per ms, `1e17` per compile ms.
   - `is_paused({})` returned `false`.
   - Command: `curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"call_function","finality":"final","account_id":"outlayer.testnet","method_name":"get_max_limits","args_base64":"e30="}}'`, then decode `result` bytes as UTF-8.
   - Write-path checks are BUILD-PLAN T1 to T6. Stop condition: any of T1 to T3 fails, then kill (BUILD-PLAN P0.6).
6. **Known conflicts:** failure refunds (integration page: metered failure; pricing page: no refund; source: metered failure, base fee on timeout). The game never relies on an OutLayer refund for player refunds; players are refunded from the game's own ledger, and the compute float absorbs OutLayer charges. Encryption key count (3 vs 5) does not matter, since one key is used.
7. **Evidence:** request tx, callback receipt, digest, latency and charge per run, attestation URL, in SMART-CONTRACT "Deployment".

### Local callback gas proof recipe

Run `make gas` in WSL. It rebuilds local, non-reproducible game/token artifacts and deploys only to an isolated sandbox with MOCK OutLayer; it does not spend testnet NEAR. The reporter uses a 64-character account and a two-literal rule, traces contextual YES plus mint, and distinguishes a genuine expected E52 mint failure from its successful allowance-restoring callback. It asserts exact debits, allowance, log/supply, pot and claim amounts. The WSL `curl` binary queries actual receipt/status RPC; receipt identity, predecessor, executor, expected status and configured gas allocation are checked. Missing or unexpected callbacks fail. Prepaid action gas, burnt gas and outgoing receipt ids are distinct quantities.

Two independent deployments cover both sweep boundaries. The original creates 21 unrevealed commits and one later Correct commit across eight 64-character sandbox accounts: 20 refunds without opening, then one refund plus open. The second creates 39 unrevealed commits and a Correct commit at sequence 19 across fourteen 64-character accounts: 19 refunds and the untouched Correct stake first, then exactly 20 refunds plus open scheduling together. Both trace actual initiating receipts separately from `on_open`, check every commit/owner and exact refund, then verify settlement partitions, returned winning stake, exactly one yocto of rounding dust and duplicate-claim rejection. The final-full-batch path is exercised locally; numeric maxima, other callback branches, Team and whole-system reserve bounds remain separate gates.

This recipe does not establish real OutLayer latency/charges, production artifact provenance or maximum-state/whole-system callback liveness. See SMART-CONTRACT for dated observed measurements and B6 for the remaining proof gates.

### Local storage funding proof recipe

Run `make storage` in WSL. It rebuilds local artifacts and uses only an isolated sandbox with MOCK OutLayer. The executable fails on sampled retained-storage underfunding and reports transient/operator liquidity separately. It also exercises two 64-character players with two verdicts and six Checking guesses pending, checks owner debits/refunds and request cleanup, then settles and starts another round with earlier state retained. Existing production allowances cover the observed retained records; request-only type bounds and sample concurrency are not whole-system reserve bounds. D27 now caps locally tracked referee requests at 10, admitting new play/guess only below 8; token/payment requests and retained rounds are not globally capped by that policy. See SMART-CONTRACT for exact measurements and B6 for remaining gates.

The same `make storage` entrypoint first runs `cargo run -p game --profile fast --example storage-bounds`, which serializes all nine actual `Request` variants with maximum-length account and play fields. It reports request-only trie-record bounds without duplicating the Borsh layout. The sandbox then reads the immutable referee admission limits from `get_params`; neither this request-only calculation nor sampled retained growth covers complete callback peaks, non-referee concurrency, lifetime rounds or Team storage.

The separate actual-Borsh lifetime proof in `contracts/game/src/storage_proof.rs` accounts for maximum-width retained records and associated transient records, including Team paths. Production initialization requires account/action/Team charges of at least 512/2,048/2,048 bytes times the runtime storage byte price; these are conservative funding floors, not a complete deployment budget. Operator collateral is separate: pre-init code/account storage, an 8,192-byte root ceiling, 1,024 bytes per retained round and ten 1,024-byte refundable referee exposures. `get_ledger` reports `operator_storage_required` for retained rounds and `operator_storage_available`; allow another 1,024 bytes at the runtime price for a new round. E24 rejects an underfunded start before creating a round or request. A direct NEAR transfer provides unallocated operator funding; `fund_compute`, `deposit_credit` and `seed_pot` allocate money elsewhere and do not fund it.

`pending_native_payments` is additionally withheld from operator availability until the matching withdrawal/platform callback completes, including while its principal is already escrowed or paid. This conservative reservation prevents a refund-first ordering from financing another round. It may reject a safe start during a pending payment; it does not authenticate that payment's outcome or permit timeout recovery.

### Local B6 continuation recipe

`make b6` in WSL rebuilds sandbox artifacts, runs single-threaded workspace tests, `token-recovery`, the four executables below plus `storage`, `balance` and `gas`, then 10,000-case `invariants`/`multiround` properties, workspace clippy, formatting and offline planner regressions. This is the planned full local gate, **not a claim that the complete target has run**. Individual executions are recorded separately. It uses MOCK OutLayer, not testnet. To run an individual executable after `scripts/build/sandbox-artifacts.sh`, use:

```sh
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example effect-gas
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example multiround
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example team-storage
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example operator-storage
```

Local actual-WASM runs exercised maximum-config/ten-active-round token and payment callbacks, overlapping rounds/claim/carry, five-member Team custody/storage, retained storage, historical native-payment balances and settlement sweeps. The authenticated-outcome rerun passed (`scratch/recovery-runtime.log`); the separate operator admission/top-up proof remains in `scratch/b6-operator-storage-runtime.log`. The repaired workspace passed 197 tests with 3 explicit ignores, all-target clippy, formatting and five Python checks (`scratch/recovery-integration.log`). Earlier single-round, two-round and mint generated gates each completed 10,000 native cases; the post-cutover bounded Team operation gate now also completed 10,000 (`scratch/recovery-team-10000.log`). These are not 10,000 on-chain rounds or arbitrary scheduler proof. The earlier interrupted composite command and complete `make b6` are not called passing.

B6 remains open for native NEAR withdrawal/platform completion: a failed callback can leave no authenticated outcome, so a timeout refund/resend can duplicate payment. RULE mint/unlock now use durable funded outcomes and same-id replay instead; that does not establish native payment recovery, universal scheduler liveness or production/testnet acceptance. See SMART-CONTRACT and D31.

The targeted 2026-11-06 continuation passed six final sandbox `round`/`guess` tests and 13 native `settle` tests. New evidence covers reversed Correct callback order with exact claims, actual-timestamp begin/open retry/cancel and phase/slot rejection atomicity. The new native payment order property passed 2,048 fixed-seed generated cases with refunds before/after callbacks and six selectable completion permutations. Unchanged full suites/Team 10k gates were not rerun. Local P2.4/P2.8 are accepted by SMART-CONTRACT's finite mapping; founder chose rehearsal and failure receipt evaluation before deciding native recovery, so P3.1/P3.3/B6/freeze remain open.

**Local withdrawal isolation (D34, 2026-11-06):** current local source separates play/payment guards; existing deployed `game-r1` still uses its previous Borsh layout. Focused credit/ABI/dispatcher/effect-bound/storage checks, the fixed-seed same-owner overlap property and maximum-config `effect-gas` runtime passed. A throwaway actual-WASM smoke observed a successful native transfer plus a genuinely failed completion export, then correct play refund/NO settlement with the payment still reserved (`scratch/native-isolation-runtime.log`); its fault source was removed. Clippy for game/sandbox all targets and changed-file formatting passed. There is no new monitor service, resolver authority or dependency, and no new signed testnet transaction. Native historical-proof prerequisites remain in SMART-CONTRACT; isolation does not close D31/B6.

**I3 resolver continuation (2026-11-06):** after rebuilding only the sandbox mock receiver, both actual-WASM `mint` tests passed. The added delayed transfer-call/unregister path checks a real resolver burn against the unchanged game mint log, exact supply/custody/allowance, receipt dependencies and once-only resume. Targeted sandbox clippy and changed-file formatting passed. The finite safety mapping and remaining storage/testnet/native-recovery gates are in SMART-CONTRACT; this is not a fresh 10k run, testnet proof or completed B6.

**Real testnet continuation (D32, 2026-11-06):** the published non-demo referee and exact current game/token artifacts completed an Unsolved Solo round with 22 real plays, four Wrong guesses, hash-matched open and actual `make verify` PASS 22/22. Both contributor claims/native withdrawals and the platform payment completed. A read-only single-final-block audit independently matched fees, pot partitions, owner credit/payouts, supply/log/allowance and permanent outcome funding; selected actual action receipts checked native recipients/amounts and callback gas. No failed contract callback was observed. RPC timeout/429 and a local solver timeout are recorded separately, not mislabeled native recovery failures. This is below P2.9's 50-play/correct-winner acceptance and does not close D31/P3.1/P3.3/B6. Public account defaults now identify the key-retaining rehearsal; no keys were deleted or GitHub push sent.

**D33 closed, r2 not started (2026-11-06):** the paused 33-play round completed the ordinary Unsolved open, verifier and three-player claim/withdrawal/platform flow. Independent final-block accounting and exact linked native receipts passed, with all D33 debit caps respected. SMART-CONTRACT contains durable tx anchors. New r2 accounts/funding/publication/deployment/run are only proposed; current Docker Linux engine access is unavailable, and the changed Player layout must not be deployed over r1. No naturally failed testnet native callback or completed native recovery is claimed.

### Local live-balance proof recipe

Run `make balance` in WSL. It rebuilds local artifacts and runs the isolated sandbox with MOCK OutLayer; no testnet funds are used. The WSL `curl` binary queries that sandbox's RPC. Solvency snapshots pin contract views and account balances to the same optimistic block, compare individual obligation deltas, and count storage funding/collateral once.

The executable traces actual withdrawal/platform transfer actions and callbacks, including a failed platform transfer, restored accrual and successful retry. It then reads every historical block between initiation and the last callback/refund, checks ledger/account agreement and exact obligation deltas, and matches the principal refund to the failed receipt's child id. Escrow, paid principal and refund receivables are distinct. The platform account is created only inside the sandbox. Receipt principal is separate from signer gas and outstanding gas refunds. This samples Solo ordering; same-block refund/callback snapshots do not establish their intra-block order, nor recovery from a failed callback, worst-case reserves or testnet behavior.

The complementary native principal model runs with `PROPTEST_CASES=10000 cargo test -p game --test invariants --profile fast -- --test-threads=1`. Its fixed RNG seed makes generated cases repeatable. Ordinary test runs use proptest's default case count. The observed 10k run took 3,400.92 seconds; run it with a suitable command deadline. Keep test capture enabled for large generated runs: expected caught rejections need not flood the log. It models failed-transfer principal at the callback boundary and does not replace actual sandbox balance/receipt checks or the remaining B6 recovery/reserve gates.

### Local token failure proof recipe

Run `make token-failure` in WSL. The current executable uses token `execute_operation`: business rejection is a successful receipt with an exact durable `receiver_unregistered` result, not an E52 receipt failure. It retains registration, allowance/log/supply, failed-unlock restoration and re-registration checks. The updated executable passed on 2026-11-06 alongside `token-recovery`, maximum-root effect gas, multi-round, Team storage, retained storage, historical native-payment balance and both settlement sweeps (`scratch/recovery-runtime.log`). All use local WASM with MOCK OutLayer, not real OutLayer or testnet.

Run `make token-recovery` for the actual-WASM callback-failure scenario. It starts with an explicitly empty token outcome budget, observes E24 leaving a mint pending, contributes funding and replays the original id. Its sandbox-only binary transformation masks exactly `on_mint`/`on_unlock` exports without changing their code or serialized state; actual callback receipts must fail method resolution after the token effect succeeds. The key-retaining local game is then redeployed with the original artifact and a third party replays the same pending operation. A two-action batch schedules both retries before either callback can consume the request. Assertions cover one-time supply/custody effects, no duplicate storage charge and preservation of a later paid replacement lock. This is deliberate fault instrumentation, not a production upgrade/recovery method or proof of gas starvation. Native tests separately cover malformed/oversized/wrong-payload acknowledgements and reconciliation after an old round settles.

Token outcomes persist forever as replay fences. `fund_operations` accepts an explicit **nonrefundable** contribution, separate from registration and game liabilities; `get_operation_funding` quotes the live 256-byte cost and remaining budget. New outcomes, including rejected operations, consume one charge; duplicates consume none. Exhausted funding stops before effects and preserves a replayable game request. Deployment must fund and monitor this lifetime storage cost; account surplus does not automatically subsidize it.

Read-only registration recovery remains separately covered by `cargo test -p game --test register_recovery --profile fast`. The previous local smoke observed a gas-starved callback, E50 before expiry, then deadline-patched one-time cleanup and normal-gas retry; it was not elapsed-ten-minute/testnet evidence. `expire_request` does not restore unknown mint/unlock effects: use authenticated same-id replay. Native withdrawal/platform requests still cannot be expired.

`cargo test -p game --test callback_fences --profile fast` exercises all nine callback dispatchers against live referee and token/payment operations, then correct completion, safe expiry, duplicates and replacement requests. It checks stored obligations and guards, not a mocked VM balance or production callback reachability. The native matrices passed after reproducing destructive wrong-kind removal; private-callback authorization remains separately covered by sandbox tests.

### Local admission proof recipe

After `scripts/build/sandbox-artifacts.sh`, run `cargo test -p sandbox-tests --profile fast --test capacity -- --nocapture` in WSL. The exercised runtime holds eight distinct verdicts, proves E23 rejects play/reveal without any stored-state mutation or new mock request, admits a lifecycle begin, and reconciles callback release, reveal/replacement and owner refunds. It uses MOCK OutLayer and independently waits for detached callback state. Native `cargo test -p game --test capacity --test recovery --profile fast` covers total limit 10, atomic finalize/open retry and duplicate/expiry fences. These checks do not prove provider throughput or whole-system reserves.

The complementary `cargo test -p sandbox-tests --profile fast --test play -- --nocapture` passed four Solo runtime tests: settled duplicate statelessness; five failure shapes and retry; delayed YES after freeze; E22 and private callback denial. It uses actual local game/token wasm with MOCK OutLayer and waits for the detached verdict callback before asserting effects. It is not P2.9 evidence.


### Local cross-target vector recipe

Run `make vectors` in WSL with cargo, Node, wasmtime and wasm-bindgen CLI 0.2.130 on `PATH` (or explicit `WASMTIME` / `WASM_BINDGEN` paths). Rust targets `wasm32-wasip2` and `wasm32-unknown-unknown` and the existing sandbox runtime are required. The script installs nothing, uses locked dependency graphs, compares 81 golden cases across native/WASI/sandbox-contract/web-target Node execution, and removes temporary files under `scratch/`. Missing tools or any mismatch fail the command. The contract adapter is test-only, not a game ABI change.

Observed 2026-11-05: all script targets passed with wasmtime 50.0.1, wasm-bindgen 0.2.130 and native WSL Node 24.22.1. A separate throwaway Chrome module Web Worker passed all 81 cases plus five verifier-export replays; Node alone is not browser evidence. The restored local wasmtime 50.0.1 archive matched GitHub's release asset SHA-256 `685466455dd42a14774a86c36c8f2e45cbb9bd6d92a850139315df60a75498a5` ([release](https://github.com/bytecodealliance/wasmtime/releases/tag/v50.0.1)); its extracted tool lives in gitignored `scratch/tools/`, and the download archive was removed. No runtime installation changed the project's Node pin. See `verifier/cli/README.md`.

### 3. Referee hosting (P0.4, P2.2)

Founder chose **Cloudflare Pages primary and FastFS testnet mirror** on 2026-11-06 (D28), replacing the raw-GitHub mirror. Main source visibility did not change and no separate public repository was created.

1. **Validate exact bytes.** Use the two independently reproduced non-demo artifacts recorded in REPRODUCIBLE-BUILDS. Check `cmp`, SHA-256, pinned `wasm-tools validate`, extracted imports, sole caller-bound manifest and absence of `RULE_DEMO`. The published referee is source `ba3d23f`, not a newly built current game/token pair.
2. **Cloudflare Pages.** The founder authenticated Chrome and authorized the relay. Direct Upload created `the-rule-referee` without a card or paid-plan activation. Only the hash-named WASM, `SHA256SUMS`, a public artifact description and `_headers` were uploaded; no repo, credentials or round answer. Use the deployment-pinned URL, not only the mutable project alias, in game init.
3. **FastFS testnet.** The official [uploader source](https://github.com/out-layer/outlayer-cli/blob/e8057527ca15a3f8bc8f1d0b4412c04ac9439533/src/commands/upload.rs) encodes Borsh `Simple` variant 0: relative path, `Some` MIME/content. Our 228,161-byte WASM fits one payload; MIME is `application/wasm`, path is `<sha256>.wasm`. The isolated `near-rule` keychain sent `__fastdata_fastfs` to `outlayer.testnet` with gas 1 and deposit 0, within the explicitly approved 0.002-NEAR ceiling. **Its expected action failure is not publication proof**: verify the public GET bytes separately.
4. **Observed.** Upload tx `3XbgZYVddhofieFctrvz154P1zUY5TbsDFkLVgEF6bru`, block `276477344`, burnt 0.0012591626714774 testnet NEAR. Both hosts returned matching GET bytes. FastFS HEAD returned 404 while GET returned 200; do not substitute HEAD for the worker's byte fetch. The old probe's 404 root cause remains unknown.
5. **Verification helper.** `scripts/referee/publish.sh FILE.wasm --verify-url https://...` checks size and downloaded hash with at most three HTTPS-only redirects. It **does not build, upload or configure hosting**. Exact URLs and repeatable verification commands are in REPRODUCIBLE-BUILDS; availability to the real OutLayer worker is checked in P2.9.

**Fresh caller-bound publication (2026-11-07, D35):** r2 uses a new two-build-matched non-demo component, hash `21b58e86fb2e19737e904fc3177f9d7871320342f0c929b626bf8d31c64c71cb`. Cloudflare deployment `ca500dd6` and the FastFS testnet mirror both passed exact-byte WSL GET checks. FastFS upload `5hVETQf6meHriCdJTzYX96WcRRiGrHUAVMz8XvB3LacT` cost 0.0012591626714774 NEAR; its omitted CLI hash was reconciled read-only without resending. Exact URLs, source/provenance and the Windows urllib 403 discrepancy are in REPRODUCIBLE-BUILDS. The r1 deployment-pinned URL remains separate; no source visibility, paid hosting or key-deletion change occurred.


### 4. Web wallet and hosting (Phase 7)

1. **Docs [V] 2026-11-04:** [NEAR wallet login guide](https://docs.near.org/web3-apps/tutorials/wallet-login.md) (`@hot-labs/near-connect` 0.12.0 + near-api-js 7.4.0); [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [headers](https://developers.cloudflare.com/pages/configuration/headers/).
2. **Human steps (founder):** create a Cloudflare account; create an API token scoped to Pages edit for one project; store it as a GitHub Actions secret `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`. Never send it in chat.
3. **Agent steps:** local run `pnpm --dir apps/web dev` (http://127.0.0.1:5173, live r2 views); checks `pnpm --dir apps/web exec tsc --noEmit`, `pnpm --dir apps/web test`, `pnpm --dir apps/web format:check`, `pnpm --dir apps/web build`. The verifier wasm package is gitignored build output: rebuild `verifier/wasm/pkg` with wasm-bindgen CLI 0.2.130 (installed in WSL `~/.cargo/bin` on 2026-11-08) before a cold build. Mascot cuts regenerate with `python scripts/web/cut-art.py` from the local, uncommitted `asset/mascot/` sheets. Deploy via CI (planned). `public/_headers` sets `Content-Type: application/wasm` for `*.wasm`; a CSP for the RPC endpoints, wallet manifest and frame origins is still planned.
4. **Environment variables (public, build time, all optional; defaults in `apps/web/src/config/env.ts` point at r2):** `VITE_RPC_URL`, `VITE_RPC_FALLBACK_URL`, `VITE_GAME_ACCOUNT`, `VITE_TOKEN_ACCOUNT`, `VITE_GAME_KIND` (`production`, `rehearsal` or `demo`; drives the visible deployment label, because r2's chain `demo` flag means a compressed rehearsal, not a preselected rule), `VITE_DEMO_GAME_ACCOUNT`, `VITE_DEMO_TOKEN_ACCOUNT`. The network is fixed to testnet.
5. **Verification:** `curl -sI https://<site>/assets/<hash>.wasm` shows `content-type: application/wasm`; a fresh browser connects a testnet wallet and reads `get_round`.

### 5. Keeper (P6.2, D20)

1. **Docs [V] 2026-11-04:** [Workers Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [limits](https://developers.cloudflare.com/workers/platform/limits/) (free: 5 cron triggers, 10 ms CPU per invocation), [secrets](https://developers.cloudflare.com/workers/configuration/secrets/); [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) (minimum 5 minutes, can be delayed or dropped); [Healthchecks pricing](https://healthchecks.io/pricing/).
2. **Human steps:** the founder creates the Healthchecks check and the Cloudflare account; the lead never receives those passwords.
3. **Agent steps:** the keeper polls `get_round` for both modes every 2 minutes and calls exactly the due transition. It pings `HEALTHCHECK_PING_URL` only after a successful final-state check. First qualification (B5): sign and send one `advance` on `game-r1` from Workers with near-api-js 7.4.0 within the CPU limit. If that fails, use the GitHub Actions schedule with the same script.
4. **Verification:** the Healthchecks dashboard shows pings; on chain, `start_round` lands within 5 minutes of the slot time.

### 6. NEAR Auth passkeys (P1 only, F22)

[V] Packages `@fast-auth-near/react-sdk` 1.3.1 and `@fast-auth-near/javascript-provider` 1.4.1 ([docs](https://docs.auth.near.org/)) depend on near-api-js `^4.0.4` and `^5.1.1`. A 3-hour timebox after Phase 8 decides whether to ship it; the fallback is a guest key plus a NEP-366 relayer (`pagoda-relayer-rs` v0.3.6, last pushed 2025-02-20), labeled.

## Skills: provenance, installation and restore

Installed 2026-11-04 by the lead with `skills` CLI 1.7.6 (npm `latest`, engines Node >= 22.20.0, repo `vercel-labs/skills`), after reading each SKILL.md. Install log kept locally in `scratch/` (not committed).

| Skill | Upstream owner / repository | Revision | License | Why needed | Installed path |
| --- | --- | --- | --- | --- | --- |
| near-smart-contracts | near / [near/agent-skills](https://github.com/near/agent-skills) | `cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b` | MIT (frontmatter) | near-sdk patterns, callbacks, yield, storage | `.claude/skills/near-smart-contracts/SKILL.md` |
| near-contract-audit | near / near/agent-skills | same | Not declared [U] | Review of mint, pot, payout and callback code (P8.1) | `.claude/skills/near-contract-audit/SKILL.md` |
| near-api-js | near / near/agent-skills | same | Not declared [U] | Keeper, verifier and web RPC and signing | `.claude/skills/near-api-js/SKILL.md` |
| building-outlayer-apps | out-layer / [out-layer/skills](https://github.com/out-layer/skills) | `d4991459e484e7f00f54ff747bb21126542cd37e` | Apache-2.0 / MIT texts present | Official OutLayer WASI and contract integration | `.claude/skills/building-outlayer-apps/SKILL.md` |
| property-based-testing | trailofbits / [trailofbits/skills](https://github.com/trailofbits/skills) | `711af095215ad4ecde5b90cd1d0124b3f1c4ca9e` | CC-BY-SA-4.0 | rule-core, equivalence and invariant properties | `.claude/skills/property-based-testing/SKILL.md` |

Review cautions, which take precedence over the skills' own text:

- `near-smart-contracts` contains `curl | sh` installers and calls `cargo near new` mandatory. Ignore both; toolchains come from this doc and scaffolding from BUILD-PLAN P0.3.
- `building-outlayer-apps` defaults to `wasm32-wasip1`, older pinned toolchains and mainnet. THE RULE uses `wasm32-wasip2`, the versions in ARCHITECTURE, and testnet.
- `near-api-js` shows a NEP-413 example with an all-zero nonce. Never copy it.
- `property-based-testing` sets `effort: low` in frontmatter. Use it for techniques, not for effort level.
- The NEAR skills without a declared license are used locally only and are not redistributed (`.claude/skills/` is gitignored).

**Install commands used (exact):**

```bash
export DISABLE_TELEMETRY=1 DO_NOT_TRACK=1
npx -y skills@1.7.6 add https://github.com/near/agent-skills/tree/cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b/skills/near-smart-contracts --skill near-smart-contracts -a claude-code --copy -y
npx -y skills@1.7.6 add https://github.com/near/agent-skills/tree/cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b/skills/near-contract-audit --skill near-contract-audit -a claude-code --copy -y
npx -y skills@1.7.6 add https://github.com/near/agent-skills/tree/cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b/skills/near-api-js --skill near-api-js -a claude-code --copy -y
npx -y skills@1.7.6 add https://github.com/out-layer/skills/tree/d4991459e484e7f00f54ff747bb21126542cd37e/building-outlayer-apps --skill building-outlayer-apps -a claude-code --copy -y
npx -y skills@1.7.6 add https://github.com/trailofbits/skills/tree/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/property-based-testing/skills/property-based-testing --skill property-based-testing -a claude-code --copy -y
```

Observed: each exited 0; `.claude/skills/` holds the five folders; `skills-lock.json` (committed) records source, ref, skill path, `computedHash` and `installMode: copy` per skill.

**Restore on a fresh clone:** re-run the five pinned `add` commands above. They recreate `.claude/skills/` copies at the locked revisions. `npx skills@1.7.6 experimental_install --frozen-lockfile` verifies hashes but restores into `.agents/skills/`, not `.claude/skills/`, per the [v1.7.6 docs](https://github.com/vercel-labs/skills/blob/v1.7.6/docs/commands.md#restore-skills-from-the-project-lock-file). Use it only as a hash check. User-level skills (hackathon-winning and the process skills in the allowlist) come from the user's global omp skill directory and cannot be fetched from this repo.

**Ignore rule:** `.claude/skills/` in `.gitignore`. **Allowlist:** `.omp/config.yml` `skills.includeSkills` lists the five project skills plus the user-level process skills.

| Skipped candidate | Reason / evidence |
| --- | --- |
| near-ai-cloud (near/agent-skills) | NEAR AI Cloud is excluded as referee (D25); API-key examples; not needed |
| agent-custody (out-layer/skills) | Registers custodial wallets, stores credentials and moves funds; wrong authority for this project |

## omp model routing

[V] `omp://config-usage.md` documents project `.omp/config.yml` with `modelRoles`, and skills loading applies `includeSkills` and custom directories. Agent definitions in `~/.omp/agent/agents/`: `executor.md` has `model: '@task'`; `secondary-executor.md` has `model: '@secondary'`.

| Role | Resolved model (project config) | Used for |
| --- | --- | --- |
| `default`, `plan` | `anthropic/claude-opus-5-5:high` | Lead |
| `task` (`executor`) | `openai-codex/gpt-6.1-terra:high` | Contracts, referee, verifier, keeper, tests, all research |
| `secondary` (`secondary-executor`) | `anthropic/claude-sonnet-5-5:high` | Visual UI only (Phase 7) |

`task.maxConcurrency: 4` (founder, 2026-11-04). At most 3 GPT workers at once (user-level lesson of 2026-10-26). Observed 2026-11-04: the research workers' session files show `model: openai-codex/gpt-6.1-terra` with `resolvedModelIsFallback: false`. Before trusting a worker, read the first `model_change` record in its session file and stop on a fallback.

## Manual actions and blockers

1. Founder: say "go" (B3), which unblocks P0.2.
2. Lead: create `therule.testnet` and send the id. Founder: fund it from the faucet (B2), which unblocks P0.4 to P0.8.
3. Founder: share design references (B1). Done 2026-11-08; Phase 7 started and D2 is decided.
4. Founder: create Cloudflare and Healthchecks accounts before P6.2 and Phase 7 deploys.
5. Founder authorized the initial source push to `github.com/Dylansius11/The-Rule` on 2026-11-05. Work belongs on `dev`; promote through a `dev` -> `main` PR. The repo reported PRIVATE. Public visibility, referee asset hosting, public posts and submission remain separate authorizations at D28/P8.6/P8.7.
