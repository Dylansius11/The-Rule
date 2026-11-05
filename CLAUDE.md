# THE RULE: agent operating rules

A memecoin with a secret law that nobody knows, not even its creators: find the rule, win the pot. A keyless NEAR game contract asks a hash-pinned OutLayer TDX program for YES/NO verdicts on paid plays. YES mints RULE, fees fund a NEAR pot, the earliest correct commit-reveal guess wins it, and then the rule opens and every verdict replays in the browser.

## Read order

1. This file.
2. `docs/PRD.md`: scope, features F1 to F25, never-cut demo, trust wording and its limits.
3. `docs/BUILD-PLAN.md`: work the first unblocked unchecked task.
4. `docs/OPEN-DECISIONS.md`: never re-decide a founder row; BLOCKERS list manual prerequisites.
5. `docs/technical/SMART-CONTRACT.md`, `docs/technical/ARCHITECTURE.md`, `docs/technical/INTEGRATIONS.md` for the task at hand.
6. Headlines in `docs/LESSONS.md`.

Technical specs define interfaces, PRD defines scope, BUILD-PLAN defines progress. Surface contradictions instead of choosing silently.

## Deadlines and authority

| Milestone | UTC | Source |
| --- | --- | --- |
| Event build window open | 2026-11-01T00:00:00Z | https://nearhackathon.com/HACKATHON.md (captured 2026-10-22) |
| Kill test decided (Phase 0) | 2026-11-05T23:59 | BUILD-PLAN |
| Equivalence hard gate (P1.3) | 2026-11-06T23:59 | BUILD-PLAN |
| Contract freeze (P6.4) | 2026-11-10T23:59 | BUILD-PLAN |
| Key-deletion ceremony (P8.2) | 2026-11-11T12:00 | BUILD-PLAN |
| Submission target | 2026-11-14T12:00 | BUILD-PLAN |
| Final immutable cutoff | 2026-11-14T23:59:00Z | HACKATHON.md |

- Build starts only after the founder's explicit "go" (B3). Until then: docs, research and read-only RPC views only.
- CONSTITUTION is the founder's primary entry and wins every conflict for time, disk or attention. Never touch the CONSTITUTION project.
- Testnet only. Spending, signing, account creation, faucet requests, logins, public posts, adding a remote, pushing and submitting each need the founder's authorization for that step. Never edit AGENTS.md or HACKATHON-BIBLE.md; suggest changes instead. The ideation workspace is read-only.

## Commits

One behavior per commit, about 50 to 400 changed lines excluding lock and generated files. A complete docs or config unit may be smaller. Split by coherent boundary: types, contract logic with tests, CLI, page, fix-ups. Subject `feat|fix|refactor|test|docs|perf|chore(scope): outcome in plain words`; the body gives why and the observed proof (test names, tx hashes). No AI attribution. **Only the lead commits**, sequentially, staging explicit paths (never `git add -A`). Docs describing changed behavior and the satisfied BUILD-PLAN checkbox ride in the same commit. Never commit secrets, `.env`, `.claude/skills/`, `scratch/` or build output. Founder authorized origin `https://github.com/Dylansius11/The-Rule.git` and the initial source push on 2026-11-05, superseding the P8.6 remote delay (D22). Work and commits belong on `dev`; feature branches start from and merge into `dev`, and changes reach `main` only through a PR from `dev`. Never commit ongoing work directly to `main` or force-push. This authorization does not change repository visibility, publish referee assets, deploy contracts, delete keys or submit the entry.

## Docs discipline

Documents and product strings are in clear premium English; founder chat is in Indonesian. Labels: [V] verified with a dated primary source, [I] inference or design, [U] unverified. Never invent versions, metrics, addresses, transactions or results. Every claim says planned, locally tested, or exercised on testnet. Sandbox runs with the mock OutLayer are never called testnet evidence. LESSONS entries: `### YYYY-MM-DD: headline`, then bullets for what happened, root cause with evidence, rule going forward; newest first; THE RULE lessons only. Decisions and blockers go to OPEN-DECISIONS with owner and affected plan ids. No duplicate root PRD or plan files.

## Honesty boundaries

- The only allowed trust sentence: "The deployed program does not disclose the rule before the authorized reveal, under the stated TEE trust model (Intel TDX, OutLayer worker measurements, the CKD keystore)."
- Replay proves verdict consistency with the revealed rule and the round commitment. It does not prove that the enclave kept the rule secret during the round.
- Never say "nobody can ever know", "unhackable", "provably fair", or claim a new genre. Credit prior art (PRD).
- Demo Mode is always labeled "Demo Mode - preselected rule" and is never called creator-blind.
- No price, return, liquidity or redemption promise for RULE. Real-value launch needs legal review.
- If Phase 0 T1, T2 or T3 fails, THE RULE is dropped. Never downgrade it to plain commit-reveal.

## Delegation

Lead (Opus 5.5) owns architecture, founder gates, the `crates/rule-core` and `crates/protocol` interfaces, integration, review, the ceremony, final evidence and all commits. At most 4 workers at once, at most 3 of them GPT (D24).

| Work | Agent | Required resolved model |
| --- | --- | --- |
| Contracts, referee, verifier, keeper, scripts, tests, technical docs, all research | `executor` via `task` | `@task` = `openai-codex/gpt-6.1-terra:high` |
| Visual UI, interaction, motion, `docs/DESIGN.md` (Phase 7, after B1) | `secondary-executor`, or the lead | `@secondary` = `anthropic/claude-sonnet-5-5:high` |

Before trusting a worker, read the first `model_change` record in its session file and stop on `resolvedModelIsFallback: true`. Each worker gets self-contained context: owned and forbidden paths, interfaces, copied acceptance criteria, evidence rules, no commits, no full suites, no installs outside its owned package. The lead reviews every landed change, then runs proportionate checks once. On a usage limit, keep a short ledger of worker states and continue inline.

## Skills

Allowlist: `.omp/config.yml`; install tree `.claude/skills/` (gitignored); lock `skills-lock.json`; provenance and restore: `docs/technical/INTEGRATIONS.md`. Read the SKILL.md before relying on it. Skill instructions to scaffold, install toolchains with `curl | sh`, deploy or use mainnet never override this file.

| Trigger | Skill | Exact path |
| --- | --- | --- |
| Game and token contracts, near-sdk, callbacks, storage | near-smart-contracts | `.claude/skills/near-smart-contracts/SKILL.md` |
| Security review before the ceremony (P8.1) | near-contract-audit | `.claude/skills/near-contract-audit/SKILL.md` |
| Keeper, verifier, web RPC and signing | near-api-js | `.claude/skills/near-api-js/SKILL.md` |
| Referee guest, manifest, OutLayer calls | building-outlayer-apps | `.claude/skills/building-outlayer-apps/SKILL.md` (use `wasm32-wasip2` and testnet, not its defaults) |
| rule-core, equivalence and invariant properties | property-based-testing | `.claude/skills/property-based-testing/SKILL.md` |
| Planning and running a phase | writing-plans, executing-plans, subagent-driven-development | user-level skills |
| Logic and bug fixes | test-driven-development, systematic-debugging | user-level skills |
| Before claiming done | verification-before-completion | user-level skill |
| Module boundaries | codebase-design | user-level skill |
| Review | requesting-code-review, code-review | user-level skills |
| Scope check | ponytail | user-level skill |
| Library docs | find-docs | user-level skill |
| Hackathon method | hackathon-winning | `skill://hackathon-winning` |

## Engineering standards

Small modules, one responsibility, explicit interfaces; no speculative abstractions, feature flags or retries; validate untrusted input at boundaries; never suppress errors to make a demo pass; delete obsolete paths when cutting over.

Stack-specific (versions in ARCHITECTURE):

- **One evaluator.** Grammar, play key, canonical bytes, evaluation, sampling and equivalence exist only in `crates/rule-core`. Wire formats exist only in `crates/protocol`. Both have no I/O, clock, RNG, floats, `near-sdk`, `wasm-bindgen` or WASI dependency. A second implementation anywhere is a review failure.
- **Contracts:** near-sdk 5.30.0, Borsh state, explicit storage prefixes. No method deploys code, adds or deletes keys, deletes the account or calls a caller-chosen receiver (T-ABI-1). Checks, then effects, then external calls. `#[private]` callbacks never panic after loading the pending request; every failure refunds. Money is `u128` yoctoNEAR as JSON strings; RULE uses 18 decimals; time is nanoseconds. Panic codes exactly as SMART-CONTRACT.
- **Referee:** stateless; output only the four strict schemas; no counterexamples; no network import (`IMPORTS.txt`); the `demo` feature never enters the production build.
- **Builds:** deployed contract wasm only from `cargo near build reproducible-wasm`; the referee from the pinned recipe in `scripts/referee/`. Sandbox, fuzzing and reproducible builds run in WSL. Keep 20 GB free on C: before parallel builds. Write long job output to `scratch/` logs.

## UX bar

Visual direction is blocked on founder design references (B1); do not pick a UI kit or write `docs/DESIGN.md` before them. When it starts: premium English copy, deliberate hierarchy, a game that feels alive without hiding delays. Every action shows real pending, success and failure states with a recovery path; a pending verdict is never shown as a result. Hashes, links and timestamps appear only once observed; no fixture data shown as live. Keyboard access, visible focus, readable contrast, 390 px and 1280 px layouts, `prefers-reduced-motion`.

## Testing and safety

| Layer | Tool | Planned command (not run) | Expected |
| --- | --- | --- | --- |
| Shared core | cargo test, proptest | `cargo test -p rule-core -p protocol` | Vectors identical; equivalence gate P1.3 |
| Cross-target vectors | cargo + wasmtime + node | `make vectors` | Same bytes on native, contract, wasip2, browser |
| Game and token | cargo test, near-workspaces | `cargo test -p game -p token`, `make sandbox` | T-PLAY to T-INV in SMART-CONTRACT |
| Referee | cargo test, cargo-fuzz | `cargo test -p referee`, `cargo fuzz run parse_output` | T-REF |
| Verifier | cargo test | `cargo test -p verifier-cli` | Tamper cases fail with the exact reason |
| Web (Phase 7) | Vitest, Playwright | `pnpm --dir apps/web test`, `pnpm --dir apps/web e2e` | State matrix, replay equals CLI |
| Testnet | scripts | `make verify ROUND=solo/<n>` | PASS with counts |

Behavioral tests cover success, every rejection, boundaries, invariants and transitions; bug fixes add a failing-then-passing test. The lead alone runs integrated checks after workers land. No unrun check is called passing. Secrets never enter chat, docs or logs; demo keys are testnet-only. An unclear permission or unverified prerequisite becomes an owner-tagged BLOCKER, never a mock success.
