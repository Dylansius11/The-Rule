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
- [ ] **P0.4 Probe referee.** Owned: `spikes/probe-referee/`. A `wasm32-wasip2` component with outlayer 0.2.1, manifest `encryption_keys:[{"path":"rule","bind":"wasm","caller":"predecessor"}]`, `callers:{"contract":{"only":["probe-game.therule.testnet"]}}`. One op `derive(round, seed)` prints `{"d": hex(sha256(mac("rule", None, round||seed)))}` and never the MAC itself.
  - Acceptance: the component builds; `wasm-tools component wit` lists `outlayer:encryption-keys` and no network import; bytes uploaded to FastFS testnet; `sha256` recorded.
- [ ] **P0.5 Probe game contract.** Owned: `spikes/probe-game/`. near-sdk 5.30.0; `probe(round, seed)` calls `outlayer.testnet.request_execution` with `WasmUrl{url, hash, build_target}`, `resource_limits` set, deposit from `estimate_execution_cost`, then `#[private] on_probe` stores the parsed digest or the failure.
  - Acceptance: deployed to `probe-game.therule.testnet`; build via `cargo near build reproducible-wasm`; wasm sha256 recorded.
- [ ] **P0.6 Kill gates T1 to T3** (the whole claim). Commands: `scripts/probe/t1.sh`, `t2.sh`, `t3.sh`.
  - T1: two calls with the same `(round, seed)` give the same digest; a different seed gives a different digest. Receipts recorded.
  - T2: the same request from `probe-other.therule.testnet` directly, and via a second contract, is refused (access denied) and executes nothing.
  - T3: a one-byte-changed referee build called from `probe-game` gives a different digest.
  - **Kill rule:** if T1, T2 or T3 fails, stop. Record the failure and evidence in LESSONS and OPEN-DECISIONS, tell the founder, and drop THE RULE. There is no downgrade to plain commit-reveal.
- [ ] **P0.7 T4 and T5: latency, cost, failure.**
  - T4: 20 sequential and 10 parallel probes; record p50/p95/max of request-to-callback time, attached deposit, actual charge and refund. Gate: p95 above 60 s means a redesign or drop decision with the founder. Result sets `resource_limits`, `outlayer_deposit` and possibly the 80/10/10 split (D3).
  - T5: bad input, guest trap and an impossible resource limit each produce a callback the contract reads as failure (JSON `null` or promise error), with no stuck state. Capture the exact callback bytes into `tests/vectors/outlayer-callback.json` for the sandbox mock.
- [ ] **P0.8 T6 attestation.** Retrieve the attestation for one probe run; it shows the referee hash. Record the URL pattern for the README and INTEGRATIONS.

Phase 0 acceptance: T1 to T3 pass with receipts in SMART-CONTRACT "Deployment"; T4/T5/T6 measured; decision "continue" recorded in OPEN-DECISIONS by 2026-11-05T23:59.

## Phase 1: `rule-core` and `protocol` (2026-11-05 to 2026-11-06)

Shared crates are lead-owned interfaces. They have no I/O, no clock, no randomness source, no floats, and no target-specific dependency.

- [ ] **P1.1 Grammar g1.** Owned: `crates/rule-core/src/{atoms,words,play}.rs`. The 128-word list (16 categories x 8) with ids; word normalization (trim, ASCII lowercase); `Play`, `play_key()`; the daily-tier atom set (number, number-vs-prev, word, word-vs-prev, minute digit, gap bucket; no hour or weekend atoms, D18).
  - Tests: every word round-trips; normalization accepts " Otter " and rejects "otters" and non-ASCII; `play_key` is injective over a 1e6-sample property test; out-of-range fields are rejected.
- [ ] **P1.2 Canonical encoding and evaluator.** Owned: `crates/rule-core/src/{rule,canonical,eval}.rs`. Forms: one literal; two literals with AND or OR. Canonical bytes and JSON as SMART-CONTRACT "Encodings". `eval(rule, play) -> bool`, total, with no early exit that depends on secret structure.
  - Tests: decode(encode(x)) == x (proptest); unsorted, duplicate, unknown-atom and over-tier inputs are rejected; golden vectors in `tests/vectors/rule.json`.
- [ ] **P1.3 Equivalence checker: HARD GATE.** Owned: `crates/rule-core/src/equiv.rs`, `crates/rule-core/tests/equiv_brute.rs`. Per-group reachable signature method (sources/28 section 1.6) over the daily-tier domain (flags 0/1, NumPair, WordPair, Time with gap buckets 0..2).
  - Tests: differential against brute force on a reduced domain (15 numbers, 10 words, full time), **1e5 pairs, 0 mismatches**; commutation and De Morgan variants are equal; near-miss pairs are unequal; realizability unit tests for the time x gap product and the 128 words.
  - Runtime: the full-domain checker on 1,000 random pairs, built for `wasm32-wasip2`, runs under 10 s per pair in wasmtime; record max time and peak memory.
  - **Gate:** any mismatch or a time above 10 s stops Phase 2 and goes to the founder. A sampled checker is never an acceptable substitute.
- [ ] **P1.4 Sampler.** Owned: `crates/rule-core/src/sample.rs`. Deterministic `sample(drbg_seed) -> (rule, bucket)` with fairness constraints: overall acceptance in [0.15, 0.85], first-play acceptance in [0.15, 0.85], every literal necessary (more than 2% effect), measured on a fixed deterministic play sample.
  - Tests: same seed gives the same rule on native and wasm32; 10k seeds all satisfy the constraints; the bucket distribution is reported.
- [ ] **P1.5 Protocol crate.** Owned: `crates/protocol/`. `RefereeRequest`/`RefereeResponse` with strict serde (`deny_unknown_fields`), commit preimage builder, domain constants, event payload types, params type.
  - Tests: golden vectors `tests/vectors/{referee-io,commit}.json`; unknown fields, extra keys, wrong lengths and `null` are rejected.

Phase 1 acceptance: `cargo test -p rule-core -p protocol` green; P1.3 gate numbers recorded here; vectors identical under `cargo test --target wasm32-wasip2` via wasmtime.

## Phase 2: sealed round core, founder order 1 (2026-11-06 to 2026-11-08)

- [ ] **P2.1 Referee ops** (F1, F2, F5, F6). Owned: `enclave/referee/`. Ops `begin`, `verdict`, `guess`, `open`, with derivation exactly as SMART-CONTRACT; every op except `begin` recomputes the commitment and aborts on mismatch; fixed-shape output only. Cargo feature `demo` (F21) reads `RULE_DEMO` instead of sampling and is off by default.
  - Tests: with a stub MAC, fixed inputs give fixed outputs (vectors); commitment mismatch produces no stdout; no op prints key material, the rule (except `open`) or the salt (except `open`); a fuzzed stdin never panics outside the parser.
- [ ] **P2.2 Referee publish.** Owned: `scripts/referee/publish.sh`. Reproducible build recipe (pinned image), upload to FastFS testnet and a commit-pinned raw GitHub mirror, record sha256. Acceptance: both URLs return identical bytes; the hash matches a second clean build.
- [ ] **P2.3 Referee import audit.** `wasm-tools component wit` output committed as `enclave/referee/IMPORTS.txt`; no network or filesystem interface beyond what the SDK requires; the demo build hash differs from production.
- [ ] **P2.4 Game: rounds, plays, log** (F1 to F4). Owned: `contracts/game/src/{lib,params,round,play,log,ledger}.rs`. Methods as SMART-CONTRACT: `start_round`, `play`, `on_verdict`, `advance`, views. Measure storage bytes per play, account and team, and set the `storage_charge_*` params.
  - Tests: T-PLAY, T-CB, the T-ROUND subset, T-ABI-1.
- [ ] **P2.5 Game: guesses and freeze** (F5). Owned: `contracts/game/src/guess.rs`. Tests: T-GUESS, T-FREEZE-1.
- [ ] **P2.6 Game: open, settle, void, cancel** (F6, F13). Owned: `contracts/game/src/{settle,cancel}.rs`. Tests: the remaining T-ROUND, T-OPEN-2. Measure gas per method and record it in SMART-CONTRACT.
- [ ] **P2.7 Verifier** (F6). Owned: `verifier/cli/`, `verifier/wasm/`. `rule verify --network testnet --game <id> --mode solo --round N` reads the log at `final`, recomputes the commitment, replays every verdict, prints PASS with counts or the first mismatch. The wasm package exposes `verify_round(rows, rule, salt, commit)` and `consistent(rule, rows)`.
  - Tests: a tampered row, a tampered salt and a reordered log each fail with the exact reason; the native result equals the wasm result on vectors.
- [ ] **P2.8 Sandbox suite.** Owned: `tests/sandbox/`. near-workspaces 0.24.0 on WSL with a mock OutLayer contract replaying `outlayer-callback.json` (labeled mock). Covers all T-* sandbox rows.
- [ ] **P2.9 Testnet rehearsal round** on `game-r1.therule.testnet` with a real referee build (keys kept, labeled rehearsal). Acceptance: 50 real plays, one wrong and one correct guess, open with hash match, `make verify` PASS; receipts recorded.

Phase 2 acceptance: P2.9 evidence recorded. The sealed loop works on testnet with the real referee.

## Phase 3: pot, fees and stakes, founder order 2 (2026-11-08)

- [ ] **P3.1 Credit and fee split** (F8, F9). Owned: `contracts/game/src/{credit,ledger}.rs`. Tests: `withdraw_credit` without 1 yocto fails; withdraw while pending E21; T-INV-1 terms present in `get_ledger`.
- [ ] **P3.2 Stakes and payouts** (F10 to F12). Owned: `contracts/game/src/{stake,payout,claim}.rs`. Tests: T-PAY, T-GUESS stake cases, `claim` twice pays once.
- [ ] **P3.3 Invariant properties.** Owned: `contracts/game/tests/invariants.rs`. T-INV-1 and T-INV-2 over 10k random op sequences, including failures and duplicates.

Acceptance: all T-PAY and T-INV green; the P2.9 rehearsal is repeated with payouts claimed on testnet.

## Phase 4: team mode, founder order 3 (2026-11-09)

- [ ] **P4.1 Teams and roster lock** (F14). Owned: `contracts/game/src/team.rs`. Tests: T-TEAM size and lock cases.
- [ ] **P4.2 Vault and team play** (F15, F16). Tests: T-TEAM-3 property (pro-rata exactness, equal split), shared attempt limit, team stake from the vault.

Acceptance: a testnet team round with 2 or more members on rehearsal accounts, including a vault withdrawal.

## Phase 5: RULE token, founder order 4 (2026-11-09 to 2026-11-10)

- [ ] **P5.1 Token** (F17). Owned: `contracts/token/`. near-contract-standards 5.30.0; NEP-141/145/148; `mint` only by `minter`; cap. Tests: T-TOK.
- [ ] **P5.2 Mint on YES** (F18). Owned: `contracts/game/src/mint.rs`. Tests: T-INV-3, mint failure restores the allowance.
- [ ] **P5.3 RULE lock** (F19). Owned: `contracts/game/src/lock.rs`. Tests: T-LOCK.

## Phase 6: Demo Mode and schedule, founder order 5 (2026-11-10)

- [ ] **P6.1 Schedule and seasons** (F20). Owned: `contracts/game/src/season.rs`. Tests: slot enforcement; one round per mode per day; season board order.
- [ ] **P6.2 Keeper.** Owned: `apps/keeper/`. Calls `start_round`, `advance`, `finalize`, `retry_open`, `cancel` when due; pings a heartbeat only after the transition is final. First qualify near-api-js 7.4.0 signing on Cloudflare Workers (D20); otherwise use the GitHub Actions fallback. Tests: dry-run against a sandbox; a duplicate call is a harmless panic.
- [ ] **P6.3 Demo instance** (F21). Owned: `scripts/demo/`. Deploy `demo-game` and `demo-token` with demo params and the demo referee; `RULE_DEMO` set as an OutLayer secret; Reset Demo means redeploy with a fresh state. Acceptance: one compressed demo round end to end.
- [ ] **P6.4 Contract freeze.** Tag the contract and referee commit; reproducible builds of `game`, `token` and the referee; hashes recorded. After this, no contract change before submission.

## Phase 7: frontend, BLOCKED on founder design references (B1)

Starts when B1 resolves; the founder's references feed `docs/DESIGN.md`, written then. Stack: D2. Owned: `apps/web/`. Functional acceptance only (PRD screens S1 to S8):

- [ ] **P7.1** S1 Play and S6 Wallet: connect, deposit, play, pending, YES, NO, duplicate, refund and error states against `game-r1`.
- [ ] **P7.2** S2 Log: 10k-row virtualized log, filters, CSV/JSON export of filtered rows, completeness indicator.
- [ ] **P7.3** S3 Guess and S4 Reveal: commit, reveal, statuses; browser replay in a worker matches `rule verify`.
- [ ] **P7.4** S5 Team, S7 Season, S8 Demo toggle with the permanent label.
- [ ] **P7.5** Accessibility and state matrix: keyboard, focus, reduced motion, 390 px and 1280 px; Playwright e2e against sandbox plus one testnet smoke.

## Phase 8: hardening and delivery (2026-11-11 to 2026-11-14)

- [ ] **P8.1 Security review** of `game`, `token` and the referee using `near-contract-audit`; findings fixed before P6.4 or recorded as residual risk.
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
