# THE RULE: integrations and setup

## TL;DR

- **Exercised (2026-11-04):** testnet accounts and funding, the deployed Phase 0 probe, OutLayer T1 to T3 and failure/latency probes, temporary HTTPS hosting; receipts are in SMART-CONTRACT. Local sandbox game/token tests use MOCK OutLayer and are not testnet evidence.
- **Not yet exercised:** the real game/referee rehearsal, durable referee hosting, deployed keeper, web wallet and static hosting, NEAR Auth (P1).
- **Founder actions:** additional rehearsal funding (B2), design references (B1), durable hosting/publication decision (D28), then publish and submit at P8.6/P8.7. Build authorization B3 is resolved.
- **Skills:** five project skills installed into `.claude/skills/` with `skills-lock.json`; two skipped. Restore recipe below.

## Integration inventory

| Integration | Purpose | Owner | Manual / automatic | Access or cost gate | Status and source |
| --- | --- | --- | --- | --- | --- |
| OutLayer (`outlayer.testnet`) | TEE referee execution | Lead | Automatic (contract calls) | Testnet NEAR per execution, paid by the game's compute float | Phase 0 probe exercised [V] 2026-11-04; real referee remains P2.9 |
| NEAR testnet RPC | Views, transactions | Lead | Automatic | Free public endpoints; rate limits unpublished | Views and probe transactions exercised [V] 2026-11-04 |
| Testnet accounts + faucet | Parent and sub-accounts, funding | Lead creates, founder funds | Manual funding | Faucet availability | Accounts created [V] 2026-11-04; additional funding B2 |
| FastFS testnet + raw GitHub mirror | Host the referee bytes for `WasmUrl` | Lead | Script | Upload gas; publication authorization | FastFS upload returned 404; temporary tunnel exercised; durable hosting D28 open |
| NEAR Connect wallet | P0 sign-in and signing in the web app | Lead (Phase 7) | Automatic | None | Documented [V] |
| Cloudflare Pages | Static web hosting | Founder account, lead deploys | Manual account, scripted deploy | Free tier | Documented [V]; no account |
| Keeper runtime (Cloudflare Workers Cron, fallback GitHub Actions) | Permissionless transitions | Lead | Automatic | Free tier; signing qualification B5 | Local workerd signing qualified (B5); deployed/runtime rehearsal still P6.2 |
| Healthchecks.io | Keeper heartbeat alert | Founder account | Manual account | Free Hobbyist | Documented [V] |
| GitHub | Public repo, CI, raw mirror | Founder | Manual (P8.6) | None | Decided D22 |
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

Run `make gas` in WSL. It rebuilds local, non-reproducible game/token artifacts and deploys only to an isolated sandbox with MOCK OutLayer; it does not spend testnet NEAR. The executable requires the WSL `curl` binary to query the sandbox's own receipt/status RPC, matches function-call receipt ids and executors, and fails if an expected callback is missing or failed. Prepaid action gas, burnt gas and outgoing receipt ids are distinct quantities.

This recipe does not establish real OutLayer latency/charges, production artifact provenance or maximum-state/whole-system callback liveness. See SMART-CONTRACT for dated observed measurements and B6 for the remaining proof gates.

### Local storage funding proof recipe

Run `make storage` in WSL. It rebuilds local artifacts and uses only an isolated sandbox with MOCK OutLayer. The executable fails on sampled retained-storage underfunding and reports transient/operator liquidity separately. Corrected sandbox charges use the existing production allowances; measured samples are not maximum-state or concurrency bounds. See SMART-CONTRACT for the observed byte counts and B6 for the remaining storage gates.

### Local live-balance proof recipe

Run `make balance` in WSL. It rebuilds local artifacts and runs the isolated sandbox with MOCK OutLayer; no testnet funds are used. The WSL `curl` binary queries that sandbox's RPC. Solvency snapshots pin contract views and account balances to the same optimistic block, compare individual obligation deltas, and count storage funding/collateral once.

The executable traces actual withdrawal/platform transfer actions and callbacks, including a failed platform transfer, restored accrual and successful retry. It then reads every historical block between initiation and the last callback/refund, checks ledger/account agreement and exact obligation deltas, and matches the principal refund to the failed receipt's child id. Escrow, paid principal and refund receivables are distinct. The platform account is created only inside the sandbox. Receipt principal is separate from signer gas and outstanding gas refunds. This samples Solo ordering; same-block refund/callback snapshots do not establish their intra-block order, nor recovery from a callback that never executes, worst-case reserves or testnet behavior.

The complementary native principal model runs with `PROPTEST_CASES=10000 cargo test -p game --test invariants --profile fast -- --nocapture`. Its fixed RNG seed makes generated cases repeatable. Ordinary test runs use proptest's default case count. The observed 10k run took 3,400.92 seconds; run it with a suitable command deadline. It models failed-transfer principal at the callback boundary and does not replace the sandbox's actual balance/receipt checks or the remaining B6 ordering/reserve gates.

### Local token failure proof recipe

Run `make token-failure` in WSL. The real local token/game and MOCK OutLayer exercise a null registration check, registration retry without a game-credit debit, failed mint after external unregistration, restored allowance with unchanged YES, failed unlock and successful retry after re-registration. Receipt identity/status/gas checks accompany log/supply and custody/lock reconciliation. The executable was exercised locally; it does not establish worst-case callback gas, safe recovery from unknown external outcomes or testnet behavior.


### 3. Referee hosting (P0.4, P2.2)

1. **Docs [V]:** WasmUrl must be HTTPS on port 443 and a public address; the worker hashes the bytes and refuses a mismatch ([near-integration](https://app.outlayer.ai/docs/near-integration)). OutLayer source at commit `aaf60a26` follows at most 3 redirects, re-validates HTTPS, and caps wasm at 10 MiB ([compiler/mod.rs](https://raw.githubusercontent.com/out-layer/outlayer/aaf60a26855e30bc3318126382903df92dea7d3d/worker/src/compiler/mod.rs)). The [dev guide](https://app.outlayer.ai/docs/dev-guide) shows `outlayer upload <file>` returning `https://test.fastfs.io/<account>/outlayer.testnet/<sha256>.wasm`.
2. **[U]** The `outlayer` CLI install source was not found in the docs on 2026-11-04 (npm `outlayer` is an unrelated package). Next action in P0.4: locate it in the [out-layer/outlayer](https://github.com/out-layer/outlayer) repo. If it is unavailable, use the primary fallback: a commit-pinned `https://raw.githubusercontent.com/Dylansius11/the-rule/<commit>/artifacts/referee.wasm`, which requires the repo to be public, so rehearsals use FastFS.
3. **Agent steps:** `scripts/referee/publish.sh` builds, uploads to FastFS, writes the mirror file, and prints both URLs and the sha256.
4. **Verification:** `curl -sL <url> | sha256sum` equals `REFEREE_SHA256` for both URLs.

### 4. Web wallet and hosting (Phase 7, blocked on B1)

1. **Docs [V] 2026-11-04:** [NEAR wallet login guide](https://docs.near.org/web3-apps/tutorials/wallet-login.md) (`@hot-labs/near-connect` 0.12.0 + near-api-js 7.4.0); [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [headers](https://developers.cloudflare.com/pages/configuration/headers/).
2. **Human steps (founder):** create a Cloudflare account; create an API token scoped to Pages edit for one project; store it as a GitHub Actions secret `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`. Never send it in chat.
3. **Agent steps:** `pnpm --dir apps/web build`, then deploy via CI. A `_headers` file sets `Content-Type: application/wasm` for `*.wasm` and a CSP that allows the RPC endpoints, the wallet manifest and the frame origins.
4. **Environment variables (public, build time):** `VITE_NEAR_NETWORK`, `VITE_RPC_URL`, `VITE_RPC_FALLBACK_URL`, `VITE_GAME_ACCOUNT`, `VITE_TOKEN_ACCOUNT`, `VITE_DEMO_GAME_ACCOUNT`, `VITE_DEMO_TOKEN_ACCOUNT`.
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
3. Founder: share design references (B1), which unblocks Phase 7 and the D2 confirmation.
4. Founder: create Cloudflare and Healthchecks accounts before P6.2 and Phase 7 deploys.
5. Founder: create `github.com/Dylansius11/the-rule` and publish at P8.6; submit at P8.7.
