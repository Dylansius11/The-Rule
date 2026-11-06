# THE RULE: open decisions and blockers

## TL;DR

- **Decided 2026-11-04:** the core stack (D1, Option A); every economic and game rule from the founder's decision record (D3 to D19); accounts are created by the lead, with the founder funding the parent (D21); repo `Dylansius11/the-rule` (D22); MVP build order (D23).
- **Proposed, founder may override:** frontend platform stack React 19 + Vite (D2); serverless backend with a permissionless keeper (D20); lead-level details inside founder decisions (D12, D18).
- **Blockers:** the founder's "go" for the build (B3), faucet funding of the parent account (B2), design references for the frontend (B1). Phases 0 to 6 proceed without B1.

Founder-owned rows are never silently decided by agents. Status: decided, proposed, open or blocked. Closed rows keep rationale, date and evidence.

## Decisions

| Id | Decision | Owner | Status | Needed by | Resolution |
| --- | --- | --- | --- | --- | --- |
| D1 | Core stack | Founder | Decided 2026-11-04 | P0.3 | Option A: near-sdk 5.30.0, cargo-near 0.22.0, outlayer 0.2.1, wasm-bindgen 0.2.130, near-workspaces 0.24.0, proptest 1.12.0 |
| D2 | Frontend platform stack | Founder | Proposed | Phase 7 | React 19 + Vite SPA, Motion, TanStack, NEAR Connect, Cloudflare Pages |
| D3 | Ticker and play fee split | Founder | Decided 2026-11-04 | P2.4 | RULE; 0.01 NEAR; 80 pot / 15 compute / 5 platform; 80/10/10 only after T4 |
| D4 | Token mechanics | Founder | Decided 2026-11-04 | P5.1 | NEP-141 + NEP-148, mint on YES from an expiring per-round allowance, no value promise |
| D5 | Pot split, solved | Founder | Decided 2026-11-04 | P3.2 | 40 winner / 40 contributors / 10 rollover / 10 platform |
| D6 | Pot split, unsolved | Founder | Decided 2026-11-04 | P3.2 | 40 contributors / 50 rollover / 10 platform; no contributors means rollover |
| D7 | System failure | Founder | Decided 2026-11-04 | P2.4 | Full refund of the affected fee or stake; cancel-and-refund path for a stuck round |
| D8 | Contributor definition | Founder | Decided 2026-11-04 | P3.2 | First play of each unique combination, YES and NO equal, capped shares per entity |
| D9 | Duplicate plays | Founder | Decided 2026-11-04 | P2.4 | Show the old verdict; no fee, call, mint, share or log row |
| D10 | Guess stake | Founder | Decided 2026-11-04 | P3.2 | Solo 1%, Team 2% of the pot, locked at commit, minimum 0.1 NEAR |
| D11 | Guess outcomes | Founder | Decided 2026-11-04 | P2.5 | Correct: stake back + winner share. Wrong: 50% back, 50% to the pot. No counterexample |
| D12 | Commit-reveal timing and unrevealed commits | Founder frame, lead detail | Decided (detail proposed) | P2.5 | Commit any time in Investigation; earliest correct commit wins; unrevealed is treated as wrong |
| D13 | Modes | Founder | Decided 2026-11-04 | P2.4 | Solo and Team, separate rule, log and pot each; logs never mix |
| D14 | Schedule and season | Founder | Decided 2026-11-04 | P6.1 | One round per day per mode, at most 24 h, ends early when solved; 7-round season boards |
| D15 | Teams | Founder | Decided 2026-11-04 | P4.1 | At most 5 members, roster locked for the round, shared attempt limit, vault with depositor records |
| D16 | RULE lock for attempts | Founder | Decided 2026-11-04 | P5.3 | Lock before the round, tiers up to a hard cap, extra attempts pay the fee, never forfeited; fee discounts are future |
| D17 | Demo Mode | Founder | Decided 2026-11-04 | P6.3 | Separate instance, preselected rule hidden during play, permanent label, Reset Demo |
| D18 | Grammar tier for daily rounds | Lead | Decided (proposed to founder) | P1.1 | Daily tier: 1 or 2 literals over atoms without hour or weekend |
| D19 | Public log and AI | Founder | Decided 2026-11-04 | P7.2 | Search, filter, CSV/JSON export; AI and bots allowed; no anti-bot claim |
| D20 | Backend shape | Lead | Proposed | P6.2 | Serverless: chain is the backend, static app, permissionless keeper; no indexer in P0 |
| D21 | Testnet accounts | Founder | Decided 2026-11-04 | P0.2 | The lead creates `therule.testnet` and all sub-accounts in Phase 0; the founder funds the parent from the faucet |
| D22 | Source repository and branch workflow | Founder | Updated 2026-11-05 | Now; full P8.6 later | Founder authorized origin `https://github.com/Dylansius11/The-Rule.git` and initial codebase push, superseding the no-remote-until-P8.6 restriction. Initial `main` preserves the existing baseline; ongoing work is committed/pushed on `dev`. Feature branches start from and merge into `dev`; only a `dev` -> `main` PR promotes changes. No direct ongoing commits to `main` or force-push. GitHub reported PRIVATE before the first push; visibility, referee asset publication, deploy and submission are not authorized by this source push |
| D23 | MVP scope and build order | Founder | Decided 2026-11-04 | All | Order 1 core, 2 money, 3 team, 4 RULE, 5 demo and schedule; cut from the bottom with notice |
| D24 | Worker routing | Founder | Decided 2026-11-04 | All | Terra for systems, contracts, backend and all research; Sonnet only for visual UI; max 4 workers |
| D25 | Excluded integrations | Lead (from sources) | Decided | All | No NEAR AI Cloud referee, no Intents, no Chain Signatures |
| D26 | Real-value launch | Founder | Open (future) | After event | Legal review first; testnet only now |
| D27 | Referee throughput (Phase 0 T4 gate fired) | Lead, founder confirms deployment policy | Proposed; cap implemented locally 2026-11-05 | P2.4, P7 | Continue. Prior sequential p95 was 6.14 s; the concurrent probe inferred about 15 to 17 verdicts/minute [I], not a guarantee. Native tests passed the immutable local cap: total tracked referee requests <=10, new play/guess only below 8, with begin/open room; E23 changes no state or credit. Completion/expiry releases one slot; token/payment requests are excluded. This is not a physical OutLayer cap after expiry. Honest pending states and testnet load/gas proof remain; no batching or queue added. Founder may override the numeric policy before deployment. Evidence: SMART-CONTRACT |
| D28 | Durable referee hosting | Founder (publication/visibility), Lead (publish script) | Open | P2.2, P2.9, P8.3 | FastFS testnet returned HTTP 404 for the uploaded probe; a Cloudflare quick tunnel is temporary. OutLayer needs public HTTPS on port 443 (at most 3 redirects, 10 MiB, hash checked). D22 now authorizes the earlier source remote/push, but GitHub reports `Dylansius11/The-Rule` PRIVATE. A private raw/release URL is not durable public worker hosting. Changing visibility or publishing the exact referee asset still requires founder authorization, plus both URL/hash checks required by P2.2. No hosting cutover is implied by pushing source |
| D29 | RULE token registration is its own step | Lead (founder may veto) | Decided 2026-11-05; corrected by review | P5.2, P7 | Players pay standard `token.storage_deposit` directly, then call game `register_token` for a zero-deposit `storage_balance_of` check; the game never debits registration money from credit. Already-registered token users pay no second deposit. The earlier credit-funded implementation could not distinguish a new registration from a refunded existing one and is removed. Pending checks reject E57; a refresh is allowed after completion. Onboarding must confirm direct registration before the game check; a failed check can be retried without a money refund path. Until confirmed, ACCEPT mints nothing and spends no allowance. |
| D30 | Stalled recoverable requests | Lead (founder may veto) | Updated 2026-11-06 | P2.4, P3.1, P5.2, B6 | Anyone may expire begin/verdict/guess/open or a read-only registration check ten minutes after initiation, through shared failure handlers. The consumed id fences late responses; registration resets None without money/admission changes. Round deadlines and spent compute remain separate. Native withdraw/platform payments cannot expire. RULE mint/unlock use D31's authenticated same-id replay, not timeout restoration. Earlier expiry evidence remains local, not a ten-minute OutLayer/testnet SLA |
| D31 | Failed external-effect callback recovery | Founder (scope), Lead (implementation/proof) | RULE redesign locally exercised 2026-11-06; native boundary open | B6, P3.3, P6.4, P8.1 | Founder approved strengthening recovery. Token mint/unlock atomically retain funded terminal outcomes bound to immutable id/kind/recipient/amount; permissionless replay reconciles once. Actual WASM passed failed callbacks after committed effects, overlapping replay, replacement-lock custody and immutable rejection after Void/next round (`scratch/recovery-runtime.log`). Each new outcome requires a separately donated 256-byte live storage quote; duplicates cost no new record and unknown transport restores nothing. Native NEAR withdrawal/platform transfers still lack an authenticated historical result: conservative reservation prevents blind double payment but failed completion can remain stuck. No different payout asset/intermediary or acceptance of that native residual is inferred. Real-referee testnet/freeze acceptance remains separate |

### D1: core stack

Two coherent options were researched live on 2026-11-04 (`scratch/research/STACK.md`, not committed):

- **Option A, recommended and chosen.** OutLayer SDK guest (outlayer 0.2.1) for the host `mac` and stdin/stdout, wasm-bindgen generated browser bindings, near-workspaces sandbox tests on WSL, proptest. Least handwritten glue and one semantic implementation.
- **Option B.** Direct `outlayer:encryption-keys` WIT imports with wit-bindgen 0.63.0, a raw byte-buffer browser ABI without wasm-bindgen, near-sandbox 0.4.0 plus near-api 0.8.7, quickcheck and bolero. More control, but more manual memory and ABI code, and the vendor example uses an older wit-bindgen range, so host-import compatibility was unknown.

The founder chose A on 2026-11-04 in the stack question. Affected: ARCHITECTURE stack table, SMART-CONTRACT compiler section, BUILD-PLAN P0.3.

### D2: frontend platform stack

Researched live 2026-11-04 (`scratch/research/FRONTEND-STACK.md`, not committed). Visual direction is not part of this decision and stays open until B1.

- **A, recommended:** React 19.3.1 + Vite 8.3.5 SPA, TypeScript 6.0.3, React Router 7.18.5, Tailwind 4.3.4 as the CSS engine only, Motion 14.9.1 for verdict and reveal moments, TanStack Query/Table/Virtual, `@hot-labs/near-connect` 0.12.0 + near-api-js 7.4.0 (the current NEAR login guide uses this pair), wasm-bindgen output in a module Web Worker, Vitest 5.1.0 and Playwright 1.64.1, Cloudflare Pages. It is the biggest NEAR and React example base, gives agents a reliable target, and makes worker-hosted wasm simple.
- **B:** Next.js 16.4.5 static export. Prerendered pages, but server and client boundaries and static dynamic-route limits with no runtime SSR benefit.
- **C:** Svelte 5 + SvelteKit 3 static. Possibly smaller bundles, but newer conventions and fewer NEAR wallet examples mean more review of agent-written code.

Risk: the NEAR Auth SDKs (P1 passkeys) depend on near-api-js 4 and 5, not 7.4.0. P1 is isolated and P0 uses a normal wallet. The founder confirms D2 when sharing design references.

### D3 to D17 and D19: founder decision record

Source: founder decision record extracted 2026-11-04 from the ideation chat (2026-11-04 10:17 to 11:09 UTC), authoritative over the earlier dossier numbers. Each is specified in SMART-CONTRACT with exact formulas and tests. Conflicts with the dossier that the founder resolved:

- Pot on a solve: the dossier said winner 90 / rollover 10. The founder chose 40 / 40 / 10 / 10 so that every unique play, YES or NO, is paid for the information it adds.
- Wrong guess: the dossier said 90% to the pot, 10% to the protocol, plus a public counterexample. The founder chose 50% back / 50% to the pot and **no counterexample**, so a wrong guess never becomes a cheap oracle.
- Stake: the dossier said `max(0.1, 2%)`. The founder chose 1% solo and 2% team, with the same 0.1 floor.
- Duplicates: the dossier minted once per (number, word). The founder made duplicates entirely free and stateless.
- Teams, RULE lock and Demo Mode moved from future into the MVP, in the stated build order.

### D12: commit-reveal detail

Founder frame: commits any time during Investigation; reveal phase closes plays and commits; earliest valid correct commit wins; reveal deadline; unrevealed commits handled by a published rule. Lead details within that frame, proposed and published in SMART-CONTRACT:

- A reveal is allowed during Investigation too, so a correct player can end the round early. The first correct result freezes the round and opens a 30-minute reveal window for existing commits.
- An unrevealed commit at the deadline is treated as wrong (50% back, 50% to the pot), so withholding is never better than revealing.
- At most 3 open commits per entity per round, to bound pending checks.
- A reveal that fails in the enclave is refunded in full and cannot be re-revealed (D7).

### D18: daily grammar tier

Rounds last at most 24 h, so the dossier's Weekend tier (no slow-time atoms) fits. Hour-bucket and weekend atoms need days of coverage. The play key therefore holds number, word, minute digit and the line (previous YES and its gap bucket). Week and Finale tiers are future.

### D20: backend shape

Researched 2026-11-04 (`scratch/research/BACKEND-OPS.md`, not committed). Option A (chosen): the contracts are the only authority; the static app reads paged views from RPC; a keeper calls permissionless transitions; there is no database. Option B adds an indexer service with Postgres for search and leaderboards. It is deferred until RPC paging (20 to 100 calls for 10k plays) proves too slow. The keeper runtime (Cloudflare Workers Cron) needs signing qualification (B5); the fallback is GitHub Actions schedule (best effort, delays documented).

### D21: accounts

The founder asked the lead to create everything and give back the parent account id for faucet funding. `therule.testnet`, `the-rule.testnet` and `rulegame.testnet` were all `UNKNOWN_ACCOUNT` on testnet at block 276191846 (read-only RPC, 2026-11-04), so they are available today but not reserved. The lead creates the parent in P0.2 only after the founder's go (B3). Keys live only in the local `.env` and the near CLI keychain. Recovery depends on that local file, which is the accepted trade-off. The founder is asked again if anything about accounts changes.

### D24: workers

Founder instruction of 2026-11-04: GPT 6.1 Terra (`executor` via `@task`) for systems, backend, contracts and all research, including frontend stack research. Claude Sonnet 5.5 (`secondary-executor`) only for visual UI work. At most 4 workers at once. User-level lessons cap concurrent GPT workers at 3, and only the lead commits.

## BLOCKERS

| Id | Missing prerequisite | Owner | Status | Blocks plan ids | Next action / proof |
| --- | --- | --- | --- | --- | --- |
| B1 | Visual design references | Founder | Open | Phase 7, D2 confirmation | Founder shares references; lead writes `docs/DESIGN.md` then |
| B2 | Rehearsal funding and spend authorization for `therule.testnet` | Founder (funding/authorization), Lead (quote) | Top-up observed 2026-11-05; final budget open | P2.9 onward | Final read-only block `276301560`: 19.9786550313875 NEAR, up 15 NEAR from block `276300202`. Recompute required storage and compute float from final artifacts and live estimates before requesting specific deploy/funding authorization. Local tests consume no testnet funds. No new faucet request, spend or probe-account deletion is authorized by continuing local work |
| B3 | Founder "go" for the build | Founder | Resolved 2026-11-04 | - | Founder said go and asked for the best, highest-quality build; the lead started P0.2 |
| B4 | NEAR Auth SDK compatibility with near-api-js 7.4.0 | Lead | Open (P1 only) | F22 | 3-hour timebox after Phase 8; otherwise guest key + relayer, labeled |
| B5 | near-api-js signing inside Cloudflare Workers | Lead | Qualified locally 2026-11-04 | P6.2 | In local workerd (`wrangler dev`) near-api-js 7.4.0 signed and serialized a 226-byte transaction against a stub RPC; bundle 420.9 KiB (93.5 KiB gzip). Not proven: deployed Workers network, free-tier CPU, a real testnet send. Decision: Workers Cron entry stays primary; GitHub Actions template in `apps/keeper/ci/` is the fallback. Re-check on the first real testnet send |
| B6 | Worst-case storage, live-balance and full callback recovery proof | Lead (proof/code), Founder (native D31 boundary) | Open; RULE authenticated recovery locally exercised 2026-11-06 | P2.4, P3.3, P6.4, P8.1 | Updated actual-WASM callback-failure/replay, maximum-root gas, Team/multi-round custody, retained storage, native receipt-aware balance and full sweep scenarios passed (`scratch/recovery-runtime.log`). Mint request bound is now 143 B; combined first Team play 1,418 B remains below its 2,048-byte floor. These local samples and funded bounds do not establish universal gas/scheduler liveness. Extended properties are recorded individually in BUILD-PLAN. Native withdraw/platform unknown outcomes still cannot be blindly restored or resent; the native architecture/residual-risk decision and final real-referee testnet/freeze acceptance remain open |
| B7 | Usable local Docker client/Linux engine for reproducible builds | Founder (runtime), Lead (verification) | Resolved locally 2026-11-05 | - | Windows and WSL reached Docker Desktop 28.5.1 after the founder enabled the engine. Missing NEP-330 repository metadata and stale host target selection were then fixed. Game/token/referee pairs from committed source `ba3d23f` matched in fresh pinned containers; actual contract metadata views and exact referee component/import/manifest checks passed. Hashes in REPRODUCIBLE-BUILDS. No remote/publication/deploy; final freeze and hosting remain P2.2/P6.4 |

### B1

Design and frontend are deferred by founder instruction. The PRD fixes only the functional contract of each screen. No UI kit or visual library is chosen beyond the D2 platform proposal.

### B2 and B3

Account creation, faucet requests and any transaction are outside the planning session. They start with B3.
