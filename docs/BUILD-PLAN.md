# THE RULE: build plan

## TL;DR

- **Goal:** the never-cut demo in [PRD](PRD.md) on real NEAR testnet receipts, reproducible with `make verify` from a cold clone.
- **Window [V]:** the event build window opened 2026-11-01T00:00:00Z. Final immutable submission cutoff is **2026-11-14T23:59:00Z** (https://nearhackathon.com/HACKATHON.md, captured 2026-10-22). Build starts only on the founder's "go" (D1 approved the stack on 2026-11-04).
- **Internal milestones (UTC) [I]:** kill test decided 2026-11-05T23:59; equivalence gate 2026-11-06T23:59; sealed core on testnet 2026-11-08T23:59; contract freeze 2026-11-10T23:59; key-deletion ceremony 2026-11-11T12:00; first production rounds 2026-11-12; submission target 2026-11-14T12:00.
- **Priority:** CONSTITUTION wins any conflict for time, machine or attention. THE RULE cuts from the bottom of the founder's build order (D23), and the founder is told before any cut.

Work top to bottom by dependency. Check a box only with observed acceptance evidence, in the same commit. Every command below is **planned, not run**. Feature ids refer to the PRD; interfaces and error codes to [SMART-CONTRACT](technical/SMART-CONTRACT.md) and [ARCHITECTURE](technical/ARCHITECTURE.md). Do not delete unchecked work without a decision in [OPEN-DECISIONS](OPEN-DECISIONS.md).

## Phase 0: documentation, prerequisites and the kill test (2026-11-04 to 2026-11-05)

- [x] **P0.1 Docs foundation.** CLAUDE.md, PRD, BUILD-PLAN, OPEN-DECISIONS, LESSONS, ARCHITECTURE, SMART-CONTRACT, INTEGRATIONS; stack D1 approved; skills installed and locked. Evidence: commits of 2026-11-04.
- [x] **P0.2 Accounts** (D21). Lead created `therule.testnet` through the faucet service, then `probe-game`, `probe-other` and `keeper` sub-accounts on 2026-11-04. Owned: `.env` (gitignored), `.env.example`.
  - Acceptance met: `view-account-summary` shows each account (balances in SMART-CONTRACT "Deployment"); `.env.example` lists variable names only; `git grep -n ed25519:` outside docs returns nothing. Keys: parent and probe keys live in the WSL credentials home `~/.near-credentials-the-rule` (mode 600, outside the repo, used through the `near-rule` wrapper with its own CLI config); only the keeper key is in the gitignored `.env`.
- [x] **P0.3 Workspace scaffold.** Owned: `Cargo.toml` (workspace), `rust-toolchain.toml` (1.97.1, targets `wasm32-unknown-unknown`, `wasm32-wasip2`), `pnpm-workspace.yaml`, root `package.json` (pnpm 12.16.1), `Makefile` targets that print "not implemented" and exit 1, empty crates per [ARCHITECTURE layout](technical/ARCHITECTURE.md#codebase-structure-and-interfaces).
  - Acceptance met in WSL: `cargo metadata` and `cargo check --workspace` pass on rustc 1.97.1; `make verify` prints "not implemented" and fails. Not met yet: Windows Node is 24.21.0, not the 26.13.0 in D1 (no JS package exists before Phase 6, so the Node pin is decided when `apps/keeper` starts); 47 GB free on C: (above the 20 GB floor).
- [x] **P0.4 Probe referee.** Owned: `spikes/probe-referee/`. `wasm32-wasip2` component, outlayer 0.2.1, manifest `encryption_keys:[{"path":"rule","bind":"wasm","caller":"predecessor"}]`, `callers:{"contract":{"only":["probe-game.therule.testnet"]}}`; op `derive(round, seed)` prints only a digest of the MAC.
  - Evidence (SMART-CONTRACT "Phase 0 probe evidence"): builds; imports `outlayer:encryption-keys/api@0.1.0` and no network; sha256 `dd766815...3672`. **Deviation:** FastFS testnet upload was sent but `test.fastfs.io` returned 404, so the bytes were served through a temporary Cloudflare quick tunnel. Durable hosting is P2.2.
- [x] **P0.5 Probe game contract.** Owned: `spikes/probe-game/`. Deployed to `probe-game.therule.testnet` (tx `7aUo4po6g2bFqyggjCay7NpwqzkW2M1iDVVgCP6rF2U8`). **Deviation:** the spike used a non-reproducible build (133,390 bytes); the real contracts use `cargo near build reproducible-wasm` (P6.4).
- [x] **P0.6 Kill gates T1 to T3 PASSED** (2026-11-04). T1 same input gives the same digest, a different seed a different one; T2 a direct call and a call through a second contract were refused with "Nothing was executed"; T3 a one-byte change gave a different digest. Receipts: SMART-CONTRACT "Phase 0 probe evidence". Scripts: `scripts/probe/`.
  - **Kill rule:** if T1, T2 or T3 fails, stop, record, tell the founder and drop THE RULE. They did not fail, so the project continues. There is no downgrade to plain commit-reveal.
- [x] **P0.7 T4 and T5 measured; the T4 gate fired** (D27). Sequential p95 6.14 s; ten concurrent requests finish in 5.7 to 27.4 s with one failure at 121.2 s. T5: bad input, a guest trap and an impossible limit all arrive as failures (JSON `null` or a failed promise); exact bytes in `tests/vectors/outlayer-callback.json`.
- [x] **P0.8 T6 attestation.** `https://testnet-api.outlayer.ai/attestations/by-tx/<tx>` shows the referee hash and a TDX quote. The quote was not verified (scope for P8).

Phase 0 acceptance: T1 to T3 pass with receipts in SMART-CONTRACT; T4/T5/T6 measured; decision "continue" recorded as D27 in OPEN-DECISIONS (pending founder confirmation of the throughput mitigations).

## Phase 1: `rule-core` and `protocol` (2026-11-05 to 2026-11-06)

Shared crates are lead-owned interfaces. They have no I/O, no clock, no randomness source, no floats, and no target-specific dependency.

- [x] **P1.1 Grammar g1.** Owned: `crates/rule-core/src/{atoms,words,play}.rs`. The 128-word list (16 categories x 8) with ids; word normalization (trim, ASCII lowercase); `Play`, `play_key()`; the daily-tier atom set (number, number-vs-prev, word, word-vs-prev, minute digit, gap bucket; no hour or weekend atoms, D18). Done 2026-11-04 (locally tested, commit `feat(rule-core): define grammar g1`).
  - Tests: every word round-trips; normalization accepts " Otter " and rejects "otters" and non-ASCII; `play_key` is injective over a 1e6-sample property test; out-of-range fields are rejected.
- [x] **P1.2 Canonical encoding and evaluator.** Owned: `crates/rule-core/src/{rule,canonical,eval}.rs`. Forms: one literal; two literals with AND or OR. Canonical bytes and JSON as SMART-CONTRACT "Encodings". `eval(rule, play) -> bool`, total, with no early exit between literal slots (not a constant-time claim). Done 2026-11-04.
  - Tests: decode(encode(x)) == x (proptest); unsorted, duplicate, unknown-atom and over-tier inputs are rejected; golden vectors in `tests/vectors/rule.json`.
- [x] **P1.3 Equivalence checker: HARD GATE, PASSED 2026-11-04.** Owned: `crates/rule-core/src/equiv.rs`, `crates/rule-core/tests/equiv_brute.rs`. Per-group reachable signature method (sources/28 section 1.6) over the daily-tier domain (flags 0/1, NumPair, WordPair, Time with gap buckets 0..2).
  - Tests: differential against brute force on a reduced domain (15 numbers, 10 words, full time), **1e5 pairs, 0 mismatches**; commutation and De Morgan variants are equal; near-miss pairs are unequal; realizability unit tests for the time x gap product and the 128 words.
  - Runtime: the full-domain checker on 1,000 random pairs, built for `wasm32-wasip2`, runs under 10 s per pair in wasmtime; record max time and peak memory.
  - **Gate:** any mismatch or a time above 10 s stops Phase 2 and goes to the founder. A sampled checker is never an acceptable substitute.
  - **Observed (WSL release):** `differential pairs=100000 mismatches=0 equal=51429 unequal=48571 plays=676500` against an independent exhaustive per-play oracle; reachable cells 8 (no previous play) and 16 (previous play); 1,000 full-domain pairs under wasmtime 50.0.1: max 77.1 ms per pair, 12.2 s total, host peak RSS 61.5 MB; native max 83.6 ms. Limit: the daily domain uses ten minute digits and gap buckets 0..2 (D18), not the longer-round bucket 3.
- [x] **P1.4 Sampler.** Owned: `crates/rule-core/src/sample.rs`. Deterministic `sample(drbg_seed) -> (rule, bucket)` with fairness constraints: overall acceptance in [0.15, 0.85], first-play acceptance in [0.15, 0.85], every literal necessary (more than 2% effect), measured on a fixed deterministic play sample. Plus `classify(rule)` for the demo build. Observed: 10,000 seeds pass an independent checker; buckets rare 2,586 / mid 3,086 / common 4,328; 100,000 seeds max 24 attempts (bound 1,024); 64 vectors identical native and wasmtime; atom 51 is never sampled because fairness excludes it.
  - Tests: same seed gives the same rule on native and wasm32; 10k seeds all satisfy the constraints; the bucket distribution is reported.
- [x] **P1.5 Protocol crate.** Owned: `crates/protocol/`. `RefereeRequest`/`RefereeResponse` with strict serde (`deny_unknown_fields`), commit preimage builder, domain constants, event payload types, params type, `referee_context`, `grammar_hash`. Done 2026-11-04 (4 tests). Residual: `grammar_hash` covers the word list and atom ids, not atom semantics; the referee hash pins the semantics.
  - Tests: golden vectors `tests/vectors/{referee-io,commit}.json`; unknown fields, extra keys, wrong lengths and `null` are rejected.

Phase 1 acceptance: `cargo test -p rule-core -p protocol` green; P1.3 gate numbers recorded here; vectors identical under `cargo test --target wasm32-wasip2` via wasmtime.

Observed cross-target entrypoint (2026-11-05): `make vectors` checks 81 fixture cases for canonical/preimage bytes, sampling, protocol I/O and replay through native, WASI, a sandbox-only contract adapter and web-target bindings in Node. The script targets passed; a separate throwaway Chrome module Web Worker also passed all 81 adapter cases and five actual verifier-export replays. The browser smoke is not built into the make target. Production game ABI and shared evaluator interfaces are unchanged; this does not accept real OutLayer/P2.9.

## Phase 2: sealed round core, founder order 1 (2026-11-06 to 2026-11-08)

- [x] **P2.1 Referee ops** (F1, F2, F5, F6). Owned: `enclave/referee/`. Ops `begin`, `verdict`, `guess`, `open`, with derivation exactly as SMART-CONTRACT; every op except `begin` recomputes the commitment and aborts on mismatch; fixed-shape output only. Cargo feature `demo` (F21) reads `RULE_DEMO` instead of sampling and is off by default. Done locally 2026-11-04: native stub tests plus the composed component under wasmtime match the vectors; not yet run on OutLayer (P2.9).
  - Tests: with a stub MAC, fixed inputs give fixed outputs (vectors); commitment mismatch produces no stdout; no op prints key material, the rule (except `open`) or the salt (except `open`); a fuzzed stdin never panics outside the parser.
- [ ] **P2.2 Referee publish.** Owned: `scripts/referee/publish.sh`. Reproducible build recipe (pinned image), upload to FastFS testnet and a commit-pinned raw GitHub mirror, record sha256. Acceptance: both URLs return identical bytes; the hash matches a second clean build.
- [x] **P2.3 Referee import audit.** `wasm-tools component wit` output committed as `enclave/referee/IMPORTS.txt`; no network or filesystem interface beyond what the SDK requires; the demo build hash differs from production. Observed `PASS: OutLayer MAC present; no network or filesystem imports; hashes differ`. Residual: the Rust runtime imports `wasi:cli/environment`; production bytes contain no `RULE_DEMO` string.
- [ ] **P2.4 Game: rounds, plays, log** (F1 to F4). Owned: `contracts/game/src/{lib,params,round,play,log,ledger}.rs`. Methods as SMART-CONTRACT: `start_round`, `play`, `on_verdict`, `advance`, views. Measure storage bytes per play, account and team, and set the `storage_charge_*` params.
  - Tests: T-PLAY, T-CB, the T-ROUND subset, T-ABI-1.
  - **Status 2026-11-04: Solo path done and tested, not accepted.** 17 game tests (2,000 random sequences), sandbox begin test with the MOCK OutLayer, clippy and fmt clean, no-ABI build 414,062 bytes. Measured storage (sandbox): 109 B per account, 328 B pending and 420 B settled for the first solo play; defaults 160 B and 768 B are provisional. Open: the full T-PLAY and T-CB rejection matrix, team storage (P4), worst-case storage, and a property test over the full ledger (T-INV-1 with stakes and payouts).
  - **Local hardening 2026-11-05:** referee begin/verdict/guess/open requests now have permissionless ten-minute expiry through their normal failure handlers. Five native tests cover boundary/races/refunds/retries/cancel; a sandbox-only 1-Tgas callback fault plus explicitly patched deadline exercised one-time play recovery and withdrawal (not ten elapsed minutes or testnet). `make gas` traces delayed callback receipts, including ACCEPT mint scheduling and success callbacks. `make storage` measured 64-character account 135 B, first YES + entity 472 B, new lock 130 B, first commit + entity 276 B; existing 160/768-byte allowances cover all sampled retained growth. The prior 100-byte sandbox fixture failed seven checks and was aligned with those production allowances. Full-state/concurrency, Team and live-balance gates remain open; P2.4/P2.8 are not accepted.
  - **Overlap regression 2026-11-05:** three failing-before native regressions reproduced first-play refund/expiry deleting an entity with guesses: correct stake became unclaimable, a wrong stake's Void refund disappeared, and the three-open-commit limit reset. Cleanup now preserves guess/payout state. All three pass, including both correct-guess callback orders; a local MOCK OutLayer runtime also preserved the cap and claimed the overlapping correct stake. No testnet claim.
  - **Concurrent storage locally exercised 2026-11-05:** two 64-character players held two verdicts and six Checking guesses concurrently; growth was 1,038 B including pending seen entries. Request-only bounds/observations were verdict <=260 B and guess 67 B, excluding other records/callbacks. Paid/refunded plays and failed/correct checks reconciled per-owner credit, retained charges and cleanup. Settlement retained another 193 B in that sample; a second round retained 340 B with the first still stored. Existing charges covered observed player growth. No global pending cap exists, so D27 and whole-system operator sizing remain open.
- [x] **P2.5 Game: guesses and freeze** (F5). Owned: `contracts/game/src/guess.rs`. Tests: T-GUESS, T-FREEZE-1. Solo path done 2026-11-05: 25 unit tests (every E10/E11/E15/E16/E17/E18/E19/E20/E22/E32 case, 50/50 wrong split, every failure shape refunds in full and blocks re-reveal, duplicate callback is a no-op, freeze rejects plays and commits and refunds in-flight plays, a 150-case money-conservation property) plus a sandbox test through the MOCK OutLayer (refund, correct, freeze). Min-`seq` winner selection is stored in `Round.best` and is asserted in P2.6 where the winner is paid. Team commits are rejected (E32) until P4.
- [x] **P2.6 Game: open, settle, void, cancel** (F6, F13). Owned: `contracts/game/src/settle.rs`. Solo path done 2026-11-05: `finalize` (batched sweep of unrevealed commits, smallest-`seq` winner), `on_open` (hash check: Settled or Void; failure keeps Opening), `retry_open`, `cancel`, `claim`, `get_claimable`, `claim_platform`. 11 unit tests (min-`seq` winner when callbacks arrive out of order, solved and unsolved splits to the yocto, zero-share rollover, 25-commit sweep in two batches, mismatch gives Void with exact refunds, retry and timeout-cancel, phase and deadline checks, platform transfer restore, a 120-case property over every ending that conserves money and empties `claimable`) plus a sandbox run through the MOCK OutLayer (guess, finalize, open, settle, claim, second claim E56). Gas per method is still unmeasured; it is measured in the P2.9 rehearsal. Team claim and the season board land with P4 and P6.1.
- [x] **P2.7 Verifier** (F6). Owned: `verifier/cli/`, `verifier/wasm/`. `rule verify --network testnet --game <id> --mode solo --round N` reads the log at `final`, recomputes the commitment, replays every verdict, prints PASS with counts or the first mismatch. The wasm package exposes `verify_round(rows, rule, salt, commit)` and `consistent(rule, rows)`. Done against mock RPC and files (5 tests, native equals wasm on 4 vectors); the run against a real game happens in P2.9.
  - Tests: a tampered row, a tampered salt and a reordered log each fail with the exact reason; the native result equals the wasm result on vectors.
- [ ] **P2.8 Sandbox suite.** Owned: `tests/sandbox/`. near-workspaces 0.24.0 on WSL with a mock OutLayer contract replaying `outlayer-callback.json` (labeled mock). Covers all T-* sandbox rows.
- [ ] **P2.9 Testnet rehearsal round** on `game-r1.therule.testnet` with a real referee build (keys kept, labeled rehearsal). Acceptance: 50 real plays, one wrong and one correct guess, open with hash match, `make verify` PASS; receipts recorded.
  - **Preparation locally exercised 2026-11-05:** `scripts/deploy/rehearsal.py` prepares complete testnet-only deploy/init and game token-registration commands offline; execution requires an explicit flag and separate founder authorization. Synthetic smoke generation and ten invalid-input boundaries passed. Real artifact provenance, funding, hosted bytes, account setup, deploy execution and the 50-play round remain unverified; no new transaction was sent. See `scripts/deploy/README.md`. `make verify ROUND=<mode>/<id>` is now wired to the existing read-only testnet CLI; an actual make invocation passed the four-row golden replay against mock RPC, failed the tampered replay, forwarded both modes and rejected four invalid selectors. This does not accept real-round replay.

Phase 2 acceptance: P2.9 evidence recorded. The sealed loop works on testnet with the real referee.

## Phase 3: pot, fees and stakes, founder order 2 (2026-11-08)

- [ ] **P3.1 Credit and fee split** (F8, F9). Owned: `contracts/game/src/{credit,ledger}.rs`. Tests: `withdraw_credit` without 1 yocto fails; withdraw while pending E21; T-INV-1 terms present in `get_ledger`.
  - **Local credit guard 2026-11-05:** failing-before regression proved withdrawal was allowed during Checking guesses. Three new tests pass for multiple live checks, duplicate callbacks, owner isolation, every guess outcome and failed/successful withdrawal callbacks. Sandbox exercised E21 with unchanged credit while Checking and successful withdrawal afterward. Live-balance/in-flight-transfer reconciliation remains P3.3/B6; `pending_credit` only records unsettled play fee/storage debits.
  - **Local cash movement 2026-11-05:** `make balance`'s executable passed with nonzero mock request deposits, same-block ledger/account snapshots, exact per-field obligation deltas, overlapping play/guess claim, a receipt-proved 0.5-NEAR withdrawal, and failed/restored/retried 0.0063-NEAR platform payout. The extended runtime also passed historical snapshots of every payment block, distinguishing outgoing escrow, successful payment and the failed receipt's linked principal-refund receivable. Refund and callback occurred in the same observed block; no intra-block order or permanently stalled-callback recovery is claimed. Whole-system reserve proof and testnet acceptance remain open.
- [x] **P3.2 Stakes and payouts** (F10 to F12). Owned: `contracts/game/src/{guess,settle}.rs`. Solo path done 2026-11-05 with P2.5 and P2.6 (T-PAY solo rows, `claim` twice pays once). Team vault payouts (T-TEAM) follow in P4.
- [ ] **P3.3 Invariant properties.** Owned: `contracts/game/tests/invariants.rs`. T-INV-1 and T-INV-2 over 10k random op sequences, including failures and duplicates.
  - **Partial Solo evidence 2026-11-05:** 10,000 fixed-seed generated cases passed (3,339 Settled / 3,324 Void / 3,337 Cancelled), checking input/receipt-derived principal conservation, unresolved transfer escrow, per-account credit/claimable reconciliation and exact I2 partitions. Variable deposits, seed, withdrawal and play prefixes precede a mandatory multi-actor callback/failure/duplicate/claim suffix. Run `PROPTEST_CASES=10000 cargo test -p game --test invariants --profile fast`; ordinary runs use the framework default. This does not accept all public-call sequences, Team/token state, arbitrary multi-round sequences, actual refund/callback ordering or worst-case collateral; P3.3 stays unchecked.

Acceptance: all T-PAY and T-INV green; the P2.9 rehearsal is repeated with payouts claimed on testnet.

## Phase 4: team mode, founder order 3 (2026-11-09)

- [ ] **P4.1 Teams and roster lock** (F14). Owned: `contracts/game/src/team.rs`. Tests: T-TEAM size and lock cases.
- [ ] **P4.2 Vault and team play** (F15, F16). Tests: T-TEAM-3 property (pro-rata exactness, equal split), shared attempt limit, team stake from the vault.

Acceptance: a testnet team round with 2 or more members on rehearsal accounts, including a vault withdrawal.

## Phase 5: RULE token, founder order 4 (2026-11-09 to 2026-11-10)

- [x] **P5.1 Token** (F17). Owned: `contracts/token/`. near-contract-standards 5.30.0; NEP-141/145/148; `mint` only by `minter`; cap. Four unit and three sandbox tests pass locally (2026-11-05). Build both contracts through `scripts/build/sandbox-artifacts.sh` first: the export tests pin its no-ABI artifacts, not generated ABI metadata. T-ABI-1 proves the callable surface, not the absence of reachable promise actions; P8.1 reviews that.
- [x] **P5.2 Mint on YES** (F18). Owned: `contracts/game/src/mint.rs`. Solo path locally tested 2026-11-05: exact decaying mint formula, rarity scaling, failed-mint allowance restoration and low-gas guard. After pre-freeze review, players pay token storage directly; game `register_token` only checks the token balance without a credit debit (D29). Eight unit tests cover existing registration, pending/refresh, malformed/null/failed and duplicate callbacks, mint decay and failure. The real-token sandbox round checks unchanged registration credit, ACCEPT minting 100 RULE and supply matching the log. Initialization rejects mint base above allowance and unsafe gas budgets. Production callback gas still needs P2.9 measurement.
- [x] **P5.3 RULE lock** (F19). Owned: `contracts/game/src/lock.rs`. Solo path locally tested 2026-11-05: token-only receiver, full rejection refunds, tier/cap, sealing-or-next-round locks, terminal/never-started unlock and failed-transfer restoration. Twelve unit tests include 32 unfunded dust senders, new-entry versus top-up storage charging, insufficient credit and failed unlock merging with a paid replacement without double charge. The real-token sandbox covers accepted/rejected transfers and unlock. Worst-case storage sizing remains B6; Team locks follow in P4.
  - **Real-token failure paths locally exercised 2026-11-05:** `token-failure` passed null registration/retry with unchanged credit, genuine E52 mint failure after external unregistration and full allowance restoration with the YES retained, then successful 100-RULE mint. A genuine unlock transfer failure restored the full lock; re-registration/retry returned it exactly once and a further unlock rejected E56. Actual receipt identities/status/gas were checked and supply equaled logged mints. No missing-callback recovery, worst-case gas or testnet claim.

## Phase 6: Demo Mode and schedule, founder order 5 (2026-11-10)

- [ ] **P6.1 Schedule and seasons** (F20). Owned: `contracts/game/src/season.rs`. Tests: slot enforcement; one round per mode per day; season board order.
- [ ] **P6.2 Keeper.** Owned: `apps/keeper/`. Calls `start_round`, `advance`, `finalize`, `retry_open`, `cancel` when due; pings a heartbeat only after the transition is final. First qualify near-api-js 7.4.0 signing on Cloudflare Workers (D20); otherwise use the GitHub Actions fallback. Tests: dry-run against a sandbox; a duplicate call is a harmless panic. **Status:** decision logic and mock-RPC tests done (12 tests); B5 qualified locally; the sandbox dry-run waits for the settle methods.
- [ ] **P6.3 Demo instance** (F21). Owned: `scripts/demo/`. Deploy `demo-game` and `demo-token` with demo params and the demo referee; `RULE_DEMO` set as an OutLayer secret; Reset Demo means redeploy with a fresh state. Acceptance: one compressed demo round end to end.
- [ ] **P6.4 Contract freeze.** Tag the contract and referee commit; reproducible builds of `game`, `token` and the referee; hashes recorded. After this, no contract change before submission.
  - **Build entrypoint prepared 2026-11-05:** `make build-contracts` now calls both contracts through the pinned cargo-near reproducible flow; game metadata matches the existing token image/digest/locked no-ABI recipe. Locked Cargo metadata validation passed. The actual make command failed closed on missing WSL Docker integration; Windows backend pipes were also unavailable despite Desktop reporting already running (B7). No new reproducible artifact or second-build comparison is claimed. The token-only wrapper was removed and callers migrated; hosting and final artifact gates stay open.
  - **Docker prerequisite resolved 2026-11-05:** Windows and WSL both reached Docker Desktop 28.5.1. The real make command advanced to NEP-330 validation and rejected missing `package.repository`; both contracts now inherit the planned D22 repository identifier. This neither adds a remote nor publishes sources; successful clean builds and hash comparison remain unchecked.

## Phase 7: frontend, BLOCKED on founder design references (B1)

Starts when B1 resolves; the founder's references feed `docs/DESIGN.md`, written then. Stack: D2. Owned: `apps/web/`. Functional acceptance only (PRD screens S1 to S8):

- [ ] **P7.1** S1 Play and S6 Wallet: connect, deposit, play, pending, YES, NO, duplicate, refund and error states against `game-r1`.
- [ ] **P7.2** S2 Log: 10k-row virtualized log, filters, CSV/JSON export of filtered rows, completeness indicator.
- [ ] **P7.3** S3 Guess and S4 Reveal: commit, reveal, statuses; browser replay in a worker matches `rule verify`.
- [ ] **P7.4** S5 Team, S7 Season, S8 Demo toggle with the permanent label.
- [ ] **P7.5** Accessibility and state matrix: keyboard, focus, reduced motion, 390 px and 1280 px; Playwright e2e against sandbox plus one testnet smoke.

## Phase 8: hardening and delivery (2026-11-11 to 2026-11-14)

- [ ] **P8.1 Security review** of `game`, `token` and the referee using `near-contract-audit`; findings fixed before P6.4 or recorded as residual risk.
  - **Partial review 2026-11-05:** Terra reviewed game/token and commitment paths. Local regressions reproduced unfunded lock storage, duplicate token-registration debit, excessive mint base and zero callback gas. The code closes those reproduced configurations/paths; storage accounting wording now avoids double-counting collateral. Referee review, full callback gas/recovery proof, worst-case storage and live-balance invariants remain open (B6). This is not a completed whole-system audit.
  - **Observed local verification 2026-11-05 (latest):** the complete workspace run passed 140 tests with 3 explicitly ignored, including the ordinary bounded Solo principal property; the prior extended 10k run is separate, not freshly rerun. Workspace and standalone vector-adapter all-target clippy passed; workspace/adapter/verifier formatting checks passed. Actual sandbox executables passed historical payment-block reconciliation, genuine token failure/retry, concurrent storage and another retained round. All 81 cross-target fixture cases and five Chrome module-worker verifier replays matched. Prior `make verify` mock-RPC proof remains recorded above. No real-referee testnet evidence or acceptance of P2.8's full matrix, B6 or the whole-system audit.
- [ ] **P8.2 Production deploy and key-deletion ceremony** (2026-11-11T12:00). `scripts/ceremony/` runs the four ceremony steps in SMART-CONTRACT. Evidence: deploy txs, deletion txs, empty key lists at a block before the first round.
- [ ] **P8.3 Production rounds.** Solo and Team rounds on 2026-11-12, 2026-11-13 and 2026-11-14, played by the founder, testers and house bots. At least one round reaches Settled with `make verify` PASS before the video.
- [ ] **P8.4 Demo recording.** The 20 s and 2 min scripts from sources/28 section 5, with Demo Mode labeled and real rounds shown separately.
- [ ] **P8.5 README** naming CONSTITUTION as the other entry; "do X - see Y" steps; trust wording; fake-vs-real table; contract addresses; library and AI-assistance disclosure. Cold clone on another machine or a fresh WSL distro runs `make verify` and `make test`.
- [ ] **P8.6 Publish** (founder-owned): add remote `github.com/Dylansius11/the-rule`, push, make it public, post the X demo mentioning NEAR HACKATHON.
- [ ] **P8.7 Submit** by 2026-11-14T12:00Z: the lead prints the payload, the founder confirms and submits.

## Stretch, only after Phase 8 is green

Ranked: F23 house bots and LLM agent, F25 agent kit, F24 leaderboard, F22 passkey (3-hour timebox, guest-key fallback). Cut trigger: any P0 gate open on 2026-11-13T00:00 means no stretch work.

## Traceability and ownership

| Feature | Tasks | Tests | Demo proof |
| --- | --- | --- | --- |
| F1 | P0.4 to P0.6, P2.1, P2.4 | T-ROUND, T1 to T3 | Commitment tx after the deletion block |
| F2, F3 | P2.4 | T-PLAY, T-CB | YES/NO receipts; "already tried" |
| F4 | P2.4, P7.2 | log paging tests | Export count equals `get_log` |
| F5, F7 | P1.3, P2.1, P2.5 | T-GUESS, equivalence gate | Correct guess with different syntax |
| F6 | P2.6, P2.7, P7.3 | T-OPEN, verifier tamper tests | `make verify` PASS, browser replay |
| F8 to F13 | P3.1 to P3.3, P2.6 | T-PAY, T-INV, T-ROUND | Claim receipts |
| F14 to F16 | P4.1, P4.2 | T-TEAM | Team round receipts |
| F17 to F19 | P5.1 to P5.3 | T-TOK, T-INV-3, T-LOCK | Mint log, unlock receipt |
| F20, F21 | P6.1 to P6.3 | schedule tests | Keeper heartbeat; labeled demo round |

| Owner | Scope |
| --- | --- |
| Lead (Opus 5.5) | `crates/rule-core`, `crates/protocol` interfaces, reviews, integration, ceremony, evidence, all commits |
| Terra workers (`executor`) | Contracts, referee, verifier, keeper, tests, scripts; one owned path set per worker |
| Sonnet worker (`secondary-executor`) | Phase 7 visual UI only, after B1 |
| Founder | Go decision, faucet funding (B2), design references (B1), publish (P8.6), submit (P8.7) |

Critical path: P0.6, then P1.3, P2.1, P2.4, P2.9, P6.4, P8.2, P8.3, P8.5, P8.7.
