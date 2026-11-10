# Keeper

**Qualification status (2026-11-09):** D38's native-signer Worker completed r3 Solo 12 from scheduled start to Settled, with FINAL receipts, matching open commitment and real heartbeat arrivals. **P6.2 remains open:** signed invocations consumed 31/28/25 ms, above Workers Free's documented 10-ms budget; idle samples were 9/12/10 ms. All 33 keeper tests, typecheck and actual local workerd/sandbox smoke passed. Cron is stopped and dedicated checks paused. No paid service, further round or r2/FE change was made.

Node >=22.22.2 and the existing workspace dependencies are required. Configure `NEAR_RPC_URL` and `GAME_ACCOUNT`; non-dry runs additionally require `KEEPER_ACCOUNT`, `KEEPER_PRIVATE_KEY` and `HEALTHCHECK_PING_URL`. Never commit values or print secrets. `NEAR_NETWORK` defaults to `testnet`. The keeper requires the RPC status chain ID `testnet` and `.testnet` game and keeper accounts. This trusts the configured RPC's answer, not a cryptographic network attestation. Running against testnet, spending or deployment requires separate founder authorization.

Authorization fences are optional: `KEEPER_MODES` accepts exactly `0`, `1`, or `0,1` (default both); `FIRST_ROUND_ID` (default 0) and `LAST_ROUND_ID` (default unlimited) define an inclusive decimal u32 range. Reversed ranges reject before network access. The keeper rechecks the actual target before signing and ignores pending rounds outside that range for heartbeat health. For exactly Solo 12, set modes `0` and both bounds `12`; a ceiling alone would also authorize earlier rounds. These bounds are not permission to send. Season indexing is whole-season through `floor(bound / 7)` and cannot exclude other candidates in a partially authorized season. Leave maintenance disabled when they are outside the authorization. Qualification config always retains no Cron by default.

```sh
pnpm --dir apps/keeper start -- --dry-run
```

Dry run reads the network and a single final-block snapshot and prints decisions; it never signs or pings. Each snapshot pins `get_params`, `get_active_rounds` and both `get_next_slot` views to one final block and timestamp. Before each send the keeper obtains a fresh snapshot, rechecks the original decision and supplies its exact `round_id` to every lifecycle method, including `start_round`, `advance` and `finalize`. A stale target is not sent. Calls use zero deposit; lifecycle calls use 300 Tgas. No transport, signing or send retry is attempted. A pending begin/open remains waiting even after its timeout: only a failed request can be retried or cancelled. Fixed logical deadlines are not extended by a late keeper. A `finalize` returning `null` can sweep a batch without opening the round.

`MAINTAIN_SEASONS=true` opts a fresh Phase 6 deployment into season maintenance; leave it unset or `false` for the historical r2 interface. After lifecycle actions, the keeper considers current and overlapping active rounds' seasons and the previous season in each mode, deduplicates them, and submits at most one 20-candidate batch per dirty season per invocation. It checks the exact revision and increased indexing cursor at a final block and rechecks before heartbeat. Partial progress is not a ready board; older seasons outside this bounded set require explicit permissionless indexing. Dry run also reports dirty seasons without signing. The option is not a fallback for missing views; when enabled, missing or malformed season views fail closed.

Heartbeat requires FINAL status, successful returned receipt outcomes and a compatible observed postcondition for every attempted action. The transaction's action outcome must be present; gas/data receipt IDs need not themselves have an execution outcome. This is not a claim that every detached callback appears in the returned graph: pending or failed begin/open states suppress heartbeat, including on an idle run. E10/E50 races are not resubmitted and suppress heartbeat; unknown outcomes and stale decisions also suppress it. An idle heartbeat only confirms a successful final state observation. Before its single broadcast, the keeper logs the public transaction hash, signer, nonce and method, never signed bytes, arguments, URLs or credentials. Failures log only the stage and bounded RPC failure category; reconcile an unknown hash read-only before another action. D31's native unknown-outcome risk remains unrecovered.

## Observed deployed qualification

D37 authorized only Solo 0 on fresh `game-r3.therule.testnet`, signed by `keeper-p6.therule.testnet`, with no season indexing. The game uses compressed `demo:true` scheduling with a **non-demo**, caller-bound referee and no preselected rule. It is not the separate Demo instance.

| Action | Public transaction | Observed CPU |
| --- | --- | ---: |
| Start | `B8iFposPoBTcx3rj5YPZM9ayWvMgcRYATV9MGovTpfuP` | 52 ms |
| Advance | `BEcknLtYqBDq3xE5rd2bzUB42wkpvXtyGYkbyi68cdN6` | 66 ms |
| Finalize/open | `6JAADq6VozfgkqkpTWsxsZ5KfQPLQRSdGEHfrbQ8huWG` | 82 ms |

The start executed 60.159354834 seconds after the scheduled slot. Its Worker invocation subsequently threw and correctly omitted heartbeat; all returned transaction outcomes nevertheless succeeded. The original hash was reconciled without resending start. The exact exception cause was not captured and is not inferred. After bounded resumption, advance/finalize succeeded, the round opened Unsolved with no plays, and a post-terminal idle invocation completed. The dashboard independently showed finalize `outcome:ok`, CPU 82 ms and wall time 13,375 ms; `ok` is not evidence of fitting the 10-ms Free budget. Actual scheduled heartbeat arrivals continued through 20:35 UTC on 2026-11-08 during Cron-removal propagation.

At final block 276888870 the round was Settled with begin/open `ok`, no pending checks/requests/native payments or player liabilities, and funded operator collateral. The original check is retained paused for historical evidence; the separate `qualification v2` check and rotated ping capability are also paused while Cron is absent. Never manually ping a check to manufacture qualification.

The current implementation lazily imports a non-extractable native WebCrypto Ed25519 key only when signing is necessary and verifies the secret's public half before use. The SDK still constructs/serializes transactions; raw key buffers are wiped after import. RPC JSON skips the full reviver for responses without potentially unsafe integer literals, retaining exact-u64 handling when needed. These changes add no dependency. Two regressions check SDK-compatible, transaction-bound signatures and malformed/mismatched keys; the 29 lifecycle/error cases and actual local workerd signing smoke also passed.

Historical no-Cron version `146975db-3dc1-4ecc-a72d-36a1383a2c5c` had no invocation sample; its displayed startup time was never treated as CPU proof. D38 below supplies the subsequent live evidence for the native signer and exact-round fence. GitHub Actions remains an unselected fallback, not a second running keeper.

### D38: native signer and exact-round Free repeat

Committed source `ccb2349`, deployed version `6aeb0e6c-d5a9-48c0-b76e-a4bc241d75c4`, used mode 0 with both round bounds 12 and season indexing disabled. Immutable Solo slot 12 was 2026-11-09T08:08:00Z. No play, guess, new account, parent transfer or contract redeploy occurred.

| Action | Public transaction | Observed CPU |
| --- | --- | ---: |
| Start | `GQhc14RzgkJVVyY2TzvzEVtGv5EpRyRqnQuoT5XMZFUe` | 31 ms |
| Advance | `AD5sJzMxQe9hRkwe2JBvvmXTF9zLFgBMo7cktmEizuz2` | 28 ms |
| Finalize/open | `D8AXFmRszEZbtcEZRPm1KLwn37o8DZzLkyH5WfswVxog` | 25 ms |

Start executed 26.659885852 seconds after its slot. All three exact transactions carried `{mode:0,round_id:12}`, zero deposit and 300 Tgas, with FINAL success and all returned execution outcomes successful. The dashboard independently confirmed finalize CPU 25 ms, wall time 14,743 ms and the deployed version above. The post-terminal idle completed at 08:28 UTC with CPU 10 ms; preceding idle samples were 9 and 12 ms. This finite sample does **not** qualify Free, and no new failure was concealed.

The finite UTC Cron expressions were `54,58 7 9 11 *` and `4,8,20,24,28 8 9 11 *`. Four scheduled instants after the slot bounded potential gas exposure; this was not a continuous two-minute production schedule. The dedicated v2 Healthcheck used a temporary 14-minute period/five-minute grace to cover the longest finite interval. Its actual success events were independently observed at 07:58, 08:04, 08:08, 08:20, 08:24 and 08:28 UTC. No manual ping was sent. Cron was removed automatically after the final idle; API confirmed an empty schedule. The check was paused and its normal two-minute period/five-minute grace restored, with paused state independently verified.

At final block **276896435**, Solo 12 was Settled Unsolved with begin/open `ok`, zero player/transient/native/referee liabilities and funded collateral. Actual read-only CLI verification passed the open commitment with **0/0 verdicts**; it is explicitly an empty round, not verdict coverage. Keeper gas 0.0028470720225656 NEAR plus compute draw 0.00480024 equaled the independently observed child-funds debit **0.0076473120225656 NEAR**, below D38's 0.15 cap. No parent funds were transferred and no unknown action was resent.

Another live round is not authorized by this completed run. Keep Free as the founder's selected constraint; profile the actual signing/snapshot path before requesting another test rather than treating burst flexibility, startup timing or local measurements as deployed CPU acceptance.

A successful local **actual workerd** signed-advance profile was captured against the genuine sandbox, with MOCK OutLayer. RPC, response parsing and fetch frames are visible, but profiler attribution includes waits/overhead and is not a deployed CPU measurement or a proven root-cause split. A separate read-only batch probe to the selected testnet RPC returned HTTP 400 `REQUEST_VALIDATION_ERROR` / `PARSE_ERROR`: JSON-RPC batching cannot simply replace these calls on this endpoint. No batch fallback, new dependency, reduced receipt check or weaker final-state check was added. The next Free-focused design must reduce measured RPC/parsing work while preserving those guards before another live sample.

### Local candidates rejected (2026-11-10)

A bounded CPU-only investigation compared the current path with a string-aware scanner that avoids long-digit matches inside quoted JSON, and separately with reuse of decisions already computed for the same validated snapshot. Warmed results were inconsistent, so neither was adopted. No code, dependency, snapshot/finality guard or deployed runtime changed. The actual current keeper suite still passes 33 tests and typecheck.

The final scanner comparison used four samples of 1,000 invocations per scenario after warmup, deterministic in-memory RPC responses and the public test-vector signer. Median CPU milliseconds per invocation:

| Scenario | Current parser | Scanner candidate |
| --- | ---: | ---: |
| Idle | 0.390 | 0.439 |
| Signed advance | 2.125 | 2.321 |

These are local warmed Node measurements, not Cloudflare CPU, network latency or a cold-isolate budget. They justify rejecting this candidate, not accepting Free or requesting a redeploy. D38's actual CPU gate remains unchanged. Further qualification needs a defensible implementation change and separately authorized deployment/live operation; do not weaken finality, receipt checks or authorization fences to meet a timing target.



## Cloudflare qualification procedure

The `qualification` Wrangler environment deploys the same scheduled handler as the production Worker, under `the-rule-keeper-qualification`. It explicitly starts with **no Cron**, no workers.dev or preview URL, and full-sample Workers Logs. The top-level production schedule is unchanged; always use `--env qualification` below. No fetch endpoint or manual public trigger is needed.

**Prerequisites, owned by founder/lead:**

- A specific authorization for Cloudflare deployment, secrets, bounded Cron operation, testnet signing and spending: named account, fresh compatible Phase 6 game, permitted mode and inclusive round ceiling, allowed methods, spending ceiling, UTC run window, and a person responsible for monitoring and stopping. Existing r2 is not compatible; do not deploy over it or target it. Do not use the Demo game or its preselected-rule referee for this qualification.
- A deployed, funded fresh testnet game with the current Borsh layout, reviewed non-demo referee and compatible parameters; a funded testnet keeper account and usable key with appropriate permissions; a reachable testnet RPC URL. Account creation, funding and deployment require their own authorization. Verify account IDs, contract code/parameters and next slots using read-only views before proceeding.
- A Cloudflare account with Workers Free enabled, an available Cron slot, and authorization/credentials scoped to that account and this Worker. The separate Cloudflare Pages publication authorization is not Worker deployment authorization. A real Healthchecks.io check and its secret ping URL are required; if not already available, its account/check creation and access require owner authorization. Do not substitute a fabricated URL.
- The selected mode and ceiling must cover every possible action. `LAST_ROUND_ID` is **inclusive**, not an exact-round filter: earlier rounds in that mode can also be acted on. If those are outside the authorization, do not enable Cron. Keep `MAINTAIN_SEASONS` false because the season ceiling does not isolate rounds.

Use Windows PowerShell from the repository root with Windows Node and the already installed Wrangler **4.157.0**. The commands below invoke its JS entrypoint directly, not a Linux shim or a package installer. Authenticate only through an already authorized Cloudflare session; if unavailable, stop for the owner. This is a repeatable procedure, not permission to repeat D37's completed round.

Use a project-isolated credential directory: `$env:XDG_CONFIG_HOME = (Join-Path (Get-Location) 'scratch/cloudflare-auth')`. The lead exercised this on 2026-11-09: the global Wrangler login belonged to another account, while isolated OAuth authenticated the founder-approved `ec31758cbebe819f854974885edf5379` account without replacing the global login. Its scopes are account/user read, Workers scripts write, tail read, Pages write and background refresh; do not expand them merely to silence Wrangler's generic missing-scope warning. Keep this directory ignored and never print its token. Recheck `whoami` with this same environment before a mutation.

1. In `apps/keeper/wrangler.jsonc`, edit **only** `env.qualification.vars`: set `NEAR_RPC_URL`, `GAME_ACCOUNT`, `KEEPER_ACCOUNT`, `KEEPER_MODES`, `FIRST_ROUND_ID` and `LAST_ROUND_ID` to the explicitly authorized target/range. The committed target is historical configuration, not permission to send. Keep `NEAR_NETWORK=testnet`, `MAINTAIN_SEASONS=false`, and qualification `crons: []`. Confirm the RPC URL contains no credentials. Never put secrets in `vars`, command arguments, shell history, output or committed files.
2. Set `$env:CLOUDFLARE_ACCOUNT_ID` in PowerShell to the owner-approved non-secret account ID, then check the selected Cloudflare account and deploy the no-Cron Worker only after authorization:

   ```powershell
   node .\apps\keeper\node_modules\wrangler\bin\wrangler.js whoami --config .\apps\keeper\wrangler.jsonc
   node .\apps\keeper\node_modules\wrangler\bin\wrangler.js deploy --config .\apps\keeper\wrangler.jsonc --env qualification
   ```

   Confirm in Workers & Pages that `the-rule-keeper-qualification` is in the intended free account, has no Cron triggers, route or workers.dev/preview URL, and has the reviewed non-secret values. If a Worker with that name already exists, inspect it first and stop on any mismatch; a deploy can overwrite it. Do not proceed if account or trigger state is uncertain.
3. Add each secret with Wrangler's masked interactive prompt, in a private terminal without transcript/recording. Paste its value only when prompted; never paste it in chat or command lines:

   ```powershell
   node .\apps\keeper\node_modules\wrangler\bin\wrangler.js secret put KEEPER_PRIVATE_KEY --config .\apps\keeper\wrangler.jsonc --env qualification
   node .\apps\keeper\node_modules\wrangler\bin\wrangler.js secret put HEALTHCHECK_PING_URL --config .\apps\keeper\wrangler.jsonc --env qualification
   ```

   Each `secret put` immediately deploys a new Worker version. Confirm the secret *names*, not values, in the dashboard and confirm Cron remains absent. Secrets are environment-specific and survive ordinary deployments. Do not proceed if either secret or its authorized source is missing.
4. Before enabling, start a separate PowerShell terminal for live output:

   ```powershell
   node .\apps\keeper\node_modules\wrangler\bin\wrangler.js tail --config .\apps\keeper\wrangler.jsonc --env qualification --format json
   ```

   With explicit approval for the exact run window, replace only qualification `crons: []` with a **date- and time-bounded UTC expression**, then deploy the same environment using the deploy command above. For example, `["10,12,14 9 12 11 *"]` selects 09:10, 09:12 and 09:14 UTC on November 12; it is illustrative, not an approved date. Enumerate only approved minutes and allow up to 15 minutes for propagation before the first scheduled instant. Cron has no year field, so this expression repeats annually if not removed; it is not an automatic permanent expiration. Do not use `*/2 * * * *` for qualification. Confirm the deployed trigger and all target fences in the dashboard before the first instant.
5. Monitor continuously. At the approved stop time, or immediately on an error, unexpected state, missing heartbeat, uncertain outcome or approaching any authorization limit, restore qualification `crons` to `[]` and run the same scoped deploy command. Confirm the trigger is absent in the dashboard and keep monitoring for at least 15 minutes: changes can take up to 15 minutes to propagate and an already-started invocation can still finish. The date/minute restriction and authorization must account for propagation and in-flight transactions; removing Cron is not an instantaneous transaction kill switch. Never resend an unknown transaction; reconcile final receipts and state first. If the stop deploy fails, use the authorized Cloudflare dashboard emergency removal for this Worker, verify removal, and investigate before proceeding.
6. Retrieve actual deployed evidence promptly: Workers & Pages → `the-rule-keeper-qualification` → **Observability**, filter the UTC window and Cron invocation logs. Record each scheduled invocation's timestamp, outcome, CPU time and wall time, relevant sanitized keeper decision/postcondition logs, and errors including `exceededCpu`; reconcile observed Healthchecks pings and final-block on-chain state/receipts with scheduled slot times. Invocation success or `decision=none` alone does not prove a transition or an on-time start; `keeper waiting; no heartbeat` is not healthy. The pre-send public hash identifies the exact transaction for independent receipt reconciliation. Live `tail` is supplementary and can drop events. Capture persisted Logs promptly within their retention window. Never copy ping URLs, private keys, signed bytes or raw exceptions into evidence.

Cloudflare documents 10 ms CPU per Free-plan Cron invocation and 50 subrequests per invocation; CPU excludes network wait. Actual deployed signed transitions and their CPU/outcomes must be observed; local workerd, bundling and idle-only invocations cannot qualify the signing path. The on-time testnet and heartbeat criteria remain open until actually demonstrated, and a finite sample is not a timeliness guarantee.

Sources checked 2026-11-09: [Cron propagation and UTC](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [environment isolation](https://developers.cloudflare.com/workers/wrangler/environments/), [secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/), and [Free limits/CPU](https://developers.cloudflare.com/workers/platform/limits/).

## Local sandbox and Worker qualification

The lead's Rust near-workspaces launcher deploys the current game WASM and MOCK OutLayer to disposable local sandbox state, funds disposable accounts and invokes `apps/keeper/ci/sandbox-smoke.ts` with `NEAR_RPC_URL`, `GAME_ACCOUNT`, `KEEPER_ACCOUNT`, `KEEPER_PRIVATE_KEY`, and `KEEPER_SMOKE_CASE`. The `race` case additionally requires distinct `RACER_ACCOUNT` and `RACER_PRIVATE_KEY`. The four cases use fresh fixtures: `advance`, `race` and `worker` need a due Solo Investigation; `pending` needs an outstanding begin. Explicit sandbox mode accepts actual RPC chain IDs `localnet`, `sandbox`, or `test-chain-<alphanumeric suffix>`, only on loopback; it rejects mainnet/testnet and never substitutes the RPC's chain ID.

The Node smoke checks dry-run state and no sends, then checks the real transition and post-state, duplicate rejection, an actual competing signed race, or the pending callback's lack of heartbeat as appropriate. `worker` starts local Wrangler with the real scheduled handler, its own loopback heartbeat receiver and real sandbox RPC; it checks the observed Reveal and heartbeat. Wrangler's temporary private variables file is created under ignored repository `scratch/` and removed after the run. Use disposable sandbox keys only; never print process environments, keys or heartbeat URLs. No cloud login or deploy is needed. A failed callback is additionally covered by the keeper behavioral tests, not by this launcher's pending case.

Observed: genuine `test-chain-<suffix>` sandbox status, real FINAL transaction outcomes and successful returned action/receipt outcomes, exact targeted round state, harmless duplicate rejection and no heartbeat for pending/raced transitions. Gas/data receipt IDs need not each have execution outcomes. MOCK OutLayer and local workerd do not establish deployed network access, free-tier CPU or natural callback-failure recovery.

Reproduce in WSL from the repo root after `scripts/build/sandbox-artifacts.sh` with the intended `CARGO_TARGET_DIR`: `cargo run --locked -p sandbox-tests --profile fast --example p6-runtime`. Optional last argument `advance`, `pending`, `race`, `worker` or `season` runs only that scenario. On this Windows/WSL host, Linux Node exercised the three Node scenarios; Windows Node/workerd exercised `worker` against the same genuine loopback sandbox. Set `P6_NODE` to the installed Windows `node.exe` path in WSL and propagate the launcher environment names through `WSLENV` (never their values in logs). The example passes only disposable keys; no cloud auth is needed.

The smoke invokes installed Wrangler through its resolved binary with the same Node executable, not `pnpm exec` across OS platforms. Do not let a Linux package-manager shim reconcile a shared Windows `node_modules`; use the matching platform or isolated project-local tooling. The existing build-script approval policy is unchanged.

Checks exercised: `pnpm --dir apps/keeper test`, `pnpm --dir apps/keeper typecheck`, actual isolated sandbox/Node scenarios and the actual local scheduled Worker handler. GitHub Actions schedules, if selected later, may be delayed or dropped and are not an on-time guarantee.
