# Testnet rehearsal deployment (P2.9 preparation)

**Offline evidence (2026-11-06):** five Python boundary tests and an actual offline CLI invocation with synthetic WASM passed, including explicit nonrefundable outcome funding before game deploy/init. Generated commands were inspected and synthetic inputs removed; no network, signature or transaction occurred. Historical committed-artifact preparation predates this funding cutover. This is not production deployment or the key-deletion ceremony. Only matching `game-rN.therule.testnet` and `token-rN.therule.testnet` accounts are targeted; both retain keys. `--execute` sends four testnet transactions through the isolated WSL `near-rule` wrapper and requires separate founder authorization for deployment, funding and registration. Generated commands are not authorization.

1. **Build and record provenance.** In WSL, run `make build-contracts CONTRACTS_OUT=scratch/repro/contracts` for both contracts through `cargo near build reproducible-wasm`, with the project's isolated `XDG_CONFIG_HOME`; see `scripts/build/contracts-reproducible.sh`. Cargo-near uses committed Git sources, so commit the reviewed unit first. Verify the two-build comparison and actual NEP-330 metadata as described in REPRODUCIBLE-BUILDS. Capture one non-demo `wasm32-wasip2` referee build's stdout: `mkdir -p scratch/deploy; RULE_GAME_ACCOUNT=game-r1.therule.testnet scripts/referee/build-reproducible.sh <workspace-snapshot> scratch/deploy/referee.wasm | tee scratch/deploy/referee-build.log`. Set `referee_build_log` to that single-build log. The planner requires its `Caller:` and sha256 to match, and reads the actual `outlayer.manifest` section. A log can still be fabricated or detached; section/string checks do not prove source, freshness, a second build or absence of every possible demo implementation. Independently validate and audit exact bytes. Rehearsal artifacts are not production freeze evidence.
2. **Prerequisites.** After separate authorization, have the matching accounts and registration payer created and sufficiently funded for wasm storage, gas and operation. Securely retain keys in THE RULE's isolated WSL keychain (`near-rule`, `~/.near-credentials-the-rule`), not `.env` or this config. Host the exact referee bytes at an HTTPS port-443 URL accessible to OutLayer; hosting/publication needs its own authorization. This script does not verify hosted content or availability. Independently verify served bytes and redirects before execution; P2.2 remains open. Determine the top-level `token_storage_deposit` from `storage_balance_bounds().min` of the **same token build and network** (for example an already deployed instance); do not guess it. It is the attached deposit for the payer's direct token `storage_deposit` registering the game account, not a game parameter. Players separately pay `token.storage_deposit` for themselves before calling game `register_token`, which checks `storage_balance_of` without attaching NEAR. Choose resource limits, then obtain testnet `estimate_execution_cost` for each operation and explicitly set deposits, with appropriate margin. Choose compute float separately: `fund_compute` is not included and needs its own authorization. B2 funding is still open.
3. **Configure.** Copy `scripts/deploy/example.json` into gitignored `scratch/deploy/config.json`, then replace **all illustrative values** with reviewed rehearsal inputs, especially paths, SHA-256 in both fields, URL, cap, schedule, limits, all four OutLayer deposits, gas, registration payer and token storage minimum. The example is synthetic, not a quote or measured cost. Amounts are decimal strings in yoctoNEAR or 18-decimal RULE; gas is integer gas, time is integer nanoseconds. The planner enforces callback >= 60 Tgas, OutLayer >= 100 Tgas, mint >= 10 Tgas, each callback-plus-outgoing gas sum <= 250 Tgas, and mint base <= round allowance; these are validation bounds, not testnet measurements. The game token, chain and referee config must match the top-level accounts, hash and testnet. `demo: true` relaxes game schedule bounds and sets the on-chain Demo Mode flag; always label it **Demo Mode - preselected rule** in any display, but this tooling requires the non-demo referee and does not provide a preselected rule. For P2.9 prefer `demo: false` and satisfy the non-demo schedule bounds; keys still remain present. `demo: false` does not make this production.

   The planner mirrors the root `bounded_config` limits: `chain_id` must be `testnet`, one or two referee URLs are allowed, each at most 2,048 UTF-8 bytes, and at most three lock tiers are allowed. It also requires `max_team_size` from one to five and enforces stricter HTTPS URL rules. For `demo: false`, it checks lifetime Borsh charge floors of 512 bytes per account and 2,048 bytes per action and Team against its fixed byte price of 10,000,000,000,000,000,000 yoctoNEAR; on-chain init checks its actual runtime storage price. These floors are not a complete operating budget or a current deployment quote. Demo initialization skips the production floors and schedule bounds; bounded configuration still applies.

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
6. **Next, after separate authorizations:** fund compute; start a Solo rehearsal and record real testnet receipts for 50 plays, a wrong and a correct guess, finalize and open; check commitment, full callback gas and actual OutLayer charges. Run the read-only `make verify ROUND=solo/<round-id> GAME_ACCOUNT=game-r1.therule.testnet` (optional `NEAR_RPC_URL=<testnet-provider>`). The target is locally exercised against mock RPC, not a real game round. These are remaining checks, not claims that this deployment tool completed them; P2.9 and P2.2 stay unchecked.

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
