# Testnet rehearsal deployment (P2.9 preparation)

**Preparation evidence (2026-11-06):** five Python boundary tests passed, then the actual offline CLI accepted the reviewed current game/token and published referee artifacts. Generated commands and exact hashes were inspected; the planner itself sent no transaction. The exact-token local quote returned a 0.00125-NEAR registration minimum and 0.00256 NEAR per retained operation. Recheck the live token quote before registration. Only matching `game-rN.therule.testnet` and `token-rN.therule.testnet` accounts are targeted; both retain keys. `--execute` sends four testnet transactions through the isolated WSL `near-rule` wrapper and requires founder authorization. D32 grants a bounded rehearsal, not production deployment or key deletion.

**CLI execution correction (2026-11-06):** near-cli-rs 0.30.1 rejected the planner's raw `"100000000000000 gas"` unit before signing or broadcast. The planner now converts integer gas exactly to decimal **Tgas** without floats, including sub-Tgas precision. The corrected generated commands deployed the reviewed token and game successfully, funded token outcomes and registered the game; live quotes and initialized parameters matched. Token deploy tx `FvwCc8iw1XSd8Z7VQrsWm7GuECCbnFCUFmLBdodANz6s`; game deploy tx `2TH4gvFLPxVa5wHpRCCbxwyGjyhMBf6iMGdNH8U91EqR`. Public `view_code` SHA-256 matched the reviewed bytes for both. Five offline boundary regressions passed after the correction; full gameplay acceptance remains separate.

**Bounded testnet result (2026-11-06):** D32 Solo 0 settled Unsolved after 22 real plays and four Wrong guesses; the 35-attempt/four-guess ceiling was not exceeded. RPC/harness interruptions prevented reaching 35 before the compressed Investigation ended. Real open matched the commitment; the actual make verifier passed 22/22. Contributor claims, native withdrawals and platform payout completed with receipt checks and independent same-final-block accounting. This is finite successful-path evidence, not the 50-play/correct-winner P2.9 criterion or unknown native callback recovery. Exact txs, economics and observed failure causes are in SMART-CONTRACT; keys remain retained.

**D33 closure (2026-11-06):** after the founder paused Solo 1 at 33 plays, its separately authorized normal closure completed Unsolved with 17 YES/16 NO, zero guesses, hash-matched open and actual verifier PASS 33/33. Three contributor claims/withdrawals and platform payment matched linked receipts. Final-block 276522837 audit reconciled all 48 actions and cleared transient liabilities within the original 3/1.25/1.25-NEAR cumulative caps. Exact durable tx anchors and arithmetic are in SMART-CONTRACT. No new round, deployment or key deletion occurred.

**Fresh-state D35 approved and deployed (2026-11-07):** founder approved `game-r2`/`token-r2`, accounts/funding/deployment, the r2-bound non-demo referee on Cloudflare/FastFS, and one Solo round through payouts. Caps: gross new debit <=13.5 testnet NEAR parent / <=1.2 each existing probe, <=75 play attempts/four guesses, two-hour Investigation. Final block 276624886 confirmed sufficient parent funds; Docker was started and serial pinned builds completed. Exact hashes/provenance/URLs, atomic deploy/init txs, live quote and deployed code/parameter checks are in REPRODUCIBLE-BUILDS. The token artifact is unchanged e546b82 bytes initialized with a new immutable minter, not a fresh token build or reuse of r1 state. The run's current acceptance belongs to BUILD-PLAN. Keep keys and native NEAR; no extra round, paid hosting, key deletion, risk acceptance, source-visibility change or push.

1. **Build and record provenance.** In WSL, run `make build-contracts CONTRACTS_OUT=scratch/repro/contracts` for both contracts through `cargo near build reproducible-wasm`, with the project's isolated `XDG_CONFIG_HOME`; see `scripts/build/contracts-reproducible.sh`. Cargo-near uses committed Git sources, so commit the reviewed unit first. Check actual NEP-330 metadata, hashes and ABI/runtime behavior as described in REPRODUCIBLE-BUILDS. The current rehearsal artifacts have one verified build each; a second independent current pair remains a freeze gate, not a claim made by this rehearsal. Capture one non-demo `wasm32-wasip2` referee build's stdout and set `referee_build_log` to that single-build log. The planner requires its `Caller:` and sha256 to match, and reads the actual `outlayer.manifest` section. A log can still be fabricated or detached; section/string checks do not prove source, freshness, a second build or absence of every possible demo implementation. Independently validate and audit exact bytes.
2. **Prerequisites.** After authorization, have the matching accounts and payer sufficiently funded for wasm storage, gas and operation. Retain keys in THE RULE's isolated WSL keychain (`near-rule`, `~/.near-credentials-the-rule`), not `.env` or this config. P2.2 hosting is verified under D28; independently recheck served bytes/redirects before execution because the planner does not fetch them. Obtain `token_storage_deposit` from the same artifact's `storage_balance_bounds().min` at the live network storage price; confirm it on the deployed token before registration. Players separately register on the token, then call game `register_token` for the zero-deposit check. Quote all four OutLayer operations and set an explicit margin. Compute, operator collateral, token outcome funding, seed and player credit are separate allocations; each needs authorization. D32 supplies the bounded rehearsal authorization, not an unlimited spending permission.
3. **Configure.** Copy `scripts/deploy/example.json` into gitignored `scratch/deploy/config.json`, replacing every illustrative artifact, hash, URL, amount, schedule, limit and payer with reviewed inputs. Amounts are decimal strings in yoctoNEAR or 18-decimal RULE; gas is integer gas, time is integer nanoseconds. The planner enforces callback >=60 Tgas, OutLayer >=100 Tgas, mint >=10 Tgas, callback-plus-outgoing <=250 Tgas and mint base <=round allowance. These are validation bounds, not testnet measurements. `demo:true` relaxes schedule and production storage validation; D32 nevertheless retains production fee/storage floors. Use the explicit compressed-rehearsal label below with the non-demo referee, not D17's preselected-rule label. Other non-demo deployments must satisfy `demo:false` scheduling bounds; neither flag makes a key-retaining rehearsal production.

   The planner mirrors the root `bounded_config` limits: `chain_id` must be `testnet`, one or two referee URLs are allowed, each at most 2,048 UTF-8 bytes, and at most three lock tiers are allowed. It also requires `max_team_size` from one to five and enforces stricter HTTPS URL rules. For `demo: false`, it checks lifetime Borsh charge floors of 512 bytes per account and 2,048 bytes per action and Team against its fixed byte price of 10,000,000,000,000,000,000 yoctoNEAR; on-chain init checks its actual runtime storage price. These floors are not a complete operating budget or a current deployment quote. Demo initialization skips the production floors and schedule bounds; bounded configuration still applies.

   **Authorized rehearsal exception (D32, 2026-11-06):** the key-retaining `game-r1` rehearsal uses `demo: true` only to compress the schedule, production fee/storage floors, and the published **non-demo** referee without `RULE_DEMO`. Label it “TESTNET REHEARSAL — KEYS RETAINED; compressed schedule; non-demo referee; no preselected rule”. It is not D17's preselected-rule Demo Mode, production-schedule evidence or a keyless launch. The founder capped this run at **35 play attempts and four guesses**, below P2.9's 50-real-play acceptance; report actual counts without checking P2.9 complete. Publication is already verified under D28; that does not establish successful worker execution.

   Budget separately funded operator collateral for pre-init code/account storage, the 8,192-byte root ceiling, 1,024 bytes per retained round and ten 1,024-byte refundable referee exposures. `get_ledger.operator_storage_required` covers currently retained rounds; add one 1,024-byte allowance for a new round, at the runtime byte price, and compare with `operator_storage_available`. Insufficient unallocated balance rejects a new round with E24. An ordinary direct NEAR transfer to the game funds this collateral; `fund_compute`, `deposit_credit` and `seed_pot` allocate funds to other ledgers and do not. The planner neither funds nor checks this balance; any transfer or compute funding requires separate authorization.

   `pending_native_payments` is conservatively excluded from operator availability until the matching payment callback completes, even when already escrowed or paid. Do not treat a pending transfer's refund as free operator capital. A failed, uncompleted callback retains that reservation; no timeout refund/retry is authorized.

   Set `token_operation_funding` (positive yoctoNEAR), `operation_funding_payer` and `operation_funding_gas` explicitly. This is a **nonrefundable donation** for permanent token operation outcomes, separate from NEP-145 registration deposits, game operator collateral, compute and player reserves. Size it for the expected number of new terminal outcomes, including business rejections, using the live token `get_operation_funding` cost per operation and a suitable margin; duplicates do not consume another charge. The example amount is illustrative, not a quote. The planner cannot verify runtime storage price or budget sufficiency; if funding is exhausted, new operations remain pending until separately authorized permissionless funding.

4. **Prepare offline and inspect.** From the repository root in WSL:

   ```sh
   python3 scripts/deploy/rehearsal.py scratch/deploy/config.json
   cat scratch/deploy/plan.json
   cat scratch/deploy/commands.sh
   ```

   This writes the init JSON, hashes, explicit funding quote and exact commands to gitignored `scratch/deploy/`: atomic token deploy + init, token `fund_operations`, atomic game deploy + init, then direct token registration of the game by the specified payer. The planner revalidates on every invocation; regenerate and inspect if inputs change. It checks local bytes, not balances, account existence, remotely served bytes, chain state or key permissions. Inspect the plan and authorization manually; generated commands are not an authorization.
5. **Only after founder authorization:** `python3 scripts/deploy/rehearsal.py scratch/deploy/config.json --execute`. The script revalidates all inputs, then sends the four actions, stopping at the first error. A later failure leaves a partial deployment: inspect receipts and state, correct the cause and plan recovery deliberately; do not blindly rerun against initialized accounts. Never delete keys here. Confirm the token's live storage minimum, operation funding and initialized params, game registration and hashes before use. Account funding and `fund_compute` remain separate actions.
6. **Within the authorized scope:** fund compute and start a Solo rehearsal; record actual play, wrong/correct guess, finalize/open, claim and native payment receipts. D35 permits <=75 attempts/four guesses on fresh r2; D32/D33 are closed historical runs, not reusable authorization. Count failed or unsigned reserved attempts conservatively and reconcile unknown transactions read-only before continuing. Check commitment, callback gas, OutLayer charges and observed failure causes. Run read-only `make verify ROUND=solo/<round-id> GAME_ACCOUNT=game-r2.therule.testnet` (optional `NEAR_RPC_URL=<testnet-provider>`). A verifier PASS proves replay consistency, not secret retention or universal callback recovery. Report actual counts against the unchanged single-round 50-play/wrong-and-correct-guess requirement.

## Referee manifest boundary

The planner reads exactly one `outlayer.manifest` custom section from core modules or nested WASI components and compares its payload with the game-bound source manifest. A literal copy in program data is not a manifest; missing or duplicate manifest sections, malformed section lengths and excessive nesting are rejected. This is a bounded section reader, not full WASM validation. Independently run the pinned `wasm-tools validate` and audit imports on the actual artifact.

The old raw-byte occurrence check rejected the actual committed referee because its manifest text appears twice (program data and the custom section). The corrected offline CLI accepted that artifact with its observed build stdout. Run the permanent boundary regressions with `python3 -B -m unittest discover -s scripts/deploy -p test_rehearsal.py -v`.

## Offline synthetic smoke for the lead

This creates deliberately **non-executable fake wasm** and a fake URL under `scratch/deploy/smoke`; it only exercises plan generation. Never use its output with `--execute` or as deployment evidence. From the repo root in WSL:

```sh
mkdir -p scratch/deploy/smoke
python3 - <<'PY'
import hashlib, json
from pathlib import Path
p = Path('scratch/deploy/smoke')
c = json.loads(Path('scripts/deploy/example.json').read_text())
manifest = Path('enclave/referee/manifest.json').read_text().strip().replace('<GAME_ACCOUNT_PLACEHOLDER>', c['game_account']).encode()
def leb(n):
    out = bytearray()
    while n >= 128:
        out.append((n & 127) | 128)
        n >>= 7
    return bytes(out) + bytes([n])
name = b'outlayer.manifest'
payload = leb(len(name)) + name + manifest
referee = b'\0asm\x01\0\0\0' + b'\0' + leb(len(payload)) + payload
for name in ('game', 'token', 'referee'):
    path = p / (name + '.wasm')
    path.write_bytes(referee if name == 'referee' else b'\0asm\x01\0\0\0\0\x08\x07fixture')
    c[name + '_wasm'] = str(path)
h = hashlib.sha256((p / 'referee.wasm').read_bytes()).hexdigest()
c['referee_sha256'] = c['params']['referee']['hash'] = h
c['referee_build_log'] = str(p / 'referee-build.log')
(p / 'referee-build.log').write_text(f"Caller: {c['game_account']}\n{h}  {p / 'referee.wasm'}\n")
(p / 'config.json').write_text(json.dumps(c))
PY
python3 scripts/deploy/rehearsal.py scratch/deploy/smoke/config.json
cat scratch/deploy/plan.json
```

The section reader is not a full WASM validator. These synthetic files contain no executable contract/referee implementation; real artifacts, exact imports, provenance and hosted bytes remain operator prerequisites.

## Native-payment incident diagnosis

Use the read-only reporter when an initiating transaction succeeds but a withdrawal or platform payment appears pending:

```sh
python3 -B scripts/deploy/native_payment.py \
  --rpc https://test.rpc.fastnear.com --game game-r2.therule.testnet \
  --tx <transaction-hash> --sender <signer-account> \
  --output scratch/native-payment-incident.json
```

The RPC must confirm testnet. The report preserves public source responses, matches the initiating receipt's direct transfer and callback through their promise-data dependency, and checks recipient, withdrawal amount, request id, receipt identity and executor. Platform recipient configuration is read at the initiating block. Transfer success/failure and callback success/failure are reported separately; missing, ambiguous or malformed evidence remains unknown. Partial failures are retained and the classification is printed.

**This is diagnosis, not on-chain authentication or recovery.** Do not infer a failed transfer from a callback or RPC error, and do not refund or resend an unknown native effect. Keep the original transaction hash and report for investigation. A successful failure callback is only consistent with restoration; inspect deployed code and state before claiming a restored balance.

Locally exercised 2026-11-07: eight focused regressions passed, including successful transfer with failed callback, incorrect recipient/amount/dependency, missing or malformed evidence and preservation of partial RPC data. The actual CLI also matched D32's successful parent withdrawal and platform payment to their real receipts and exact amounts; no naturally failed testnet callback or recovery is claimed.

**Layout cutover (D34/D35):** current source replaces aggregate `get_player.pending` with `pending_play`, `pending_withdrawal` and `checking_guesses`, adding one Borsh byte per Player. D35 deployed this layout to fresh r2 state; it was not installed over r1. A pending native payment cannot be expired or resent, but remaining credit can fund new plays. Keep D32/D33's r1 hashes and receipts as historical evidence; r2's selected artifact provenance and live checks are recorded separately.

## Offline rehearsal inference and timing qualification

`verifier/cli/examples/rehearsal-operator.rs` has no RPC, signing or secret-rule access. It filters daily candidates with the shared `rule-core` evaluator/classifier, uses exact shared equivalence for semantic classes, prepares protocol commit preimages, and suggests plays or bounded class guesses. A log-consistent candidate is not automatically the correct rule. The aid is separate from transaction submission and does not authorize a rehearsal.

Build the executable in WSL, then supply one JSON request on stdin:

```sh
CARGO_TARGET_DIR="$HOME/target-the-rule-lead" cargo build -p verifier-cli --profile fast --example rehearsal-operator
printf '%s\n' '{"command":"qualify","seeds":["p29-0"],"play_seconds":45,"guess_seconds":120,"investigation_seconds":7200}' |
  "$HOME/target-the-rule-lead/fast/examples/rehearsal-operator"
```

`qualify` requires explicit positive play/guess durations no greater than the Investigation window, whose ceiling is 86,400 seconds. It models three players with 25 attempts each, at least 50 plays, a known-wrong guess and at most three subsequent class guesses. Checked time admission refuses an action finishing at or after the deadline. Previous-YES gaps use all three published buckets. Exit 0 means every supplied fixture and the retained adversarial fixture qualified in this **finite offline model**; exit 1 means unqualified or invalid input. Simulated elapsed seconds are not the CLI's wall time, a network latency SLA or proof that every sampled game rule is identifiable.

Locally exercised 2026-11-06: eight fixed seeds plus the adversarial fixture qualified at 50 simulated plays/two guesses, 2,490 simulated seconds each with the explicit 45/120/7,200-second inputs. A short-window run refused qualification and four invalid duration boundaries rejected. After equivalent conditional cleanup for clippy, the final binary's two-fixture smoke passed; targeted clippy and changed-file formatting passed. Evidence is in `scratch/p29-next/qualification-*.json` and `operator-final-*.log`. No paid operation or new round was sent by this CLI.

The other request commands are `advise` (complete public rows/bucket, rejected rules, actual current context, excluded keys and remaining guess budget), `known_wrong` (a rule contradicted by an observed verdict), and `prepare_guess` (game, round, actor/entity, rule and salt). Advice based on a pre-sign timestamp does not fix the context at receipt inclusion: a transaction operator must inspect actual rows, entity attempts, pending callbacks, budget and deadlines before continuing. Never run the historical r1 journal against fresh r2 accounts.


