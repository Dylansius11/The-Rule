# Testnet rehearsal deployment (P2.9 preparation)

**Locally exercised, offline only (2026-11-05).** Synthetic boundary checks, CLI help, and plan generation with actual committed game/token/referee artifacts passed. The supplied URL and economics in that smoke were illustrative, not a hosted-byte check or deployment quote. No deploy, signature or registration transaction was sent. This is not the production deploy or key-deletion ceremony. It only targets matching `game-rN.therule.testnet` and `token-rN.therule.testnet` accounts; both retain their keys. Default mode does not create or fund accounts, upload bytes, call RPC or access credentials. `--execute` signs and sends three testnet transactions through the isolated WSL `near-rule` wrapper; founder authorization for deployment and the registration deposit is required first. Generated commands are not authorization.

1. **Build and record provenance.** In WSL, run `make build-contracts CONTRACTS_OUT=scratch/repro/contracts` for both contracts through `cargo near build reproducible-wasm`, with the project's isolated `XDG_CONFIG_HOME`; see `scripts/build/contracts-reproducible.sh`. Cargo-near uses committed Git sources, so commit the reviewed unit first. Verify the two-build comparison and actual NEP-330 metadata as described in REPRODUCIBLE-BUILDS. Capture one non-demo `wasm32-wasip2` referee build's stdout: `mkdir -p scratch/deploy; RULE_GAME_ACCOUNT=game-r1.therule.testnet scripts/referee/build-reproducible.sh <workspace-snapshot> scratch/deploy/referee.wasm | tee scratch/deploy/referee-build.log`. Set `referee_build_log` to that single-build log. The planner requires its `Caller:` and sha256 to match, and reads the actual `outlayer.manifest` section. A log can still be fabricated or detached; section/string checks do not prove source, freshness, a second build or absence of every possible demo implementation. Independently validate and audit exact bytes. Rehearsal artifacts are not production freeze evidence.
2. **Prerequisites.** After separate authorization, have the matching accounts and registration payer created and sufficiently funded for wasm storage, gas and operation. Securely retain keys in THE RULE's isolated WSL keychain (`near-rule`, `~/.near-credentials-the-rule`), not `.env` or this config. Host the exact referee bytes at an HTTPS port-443 URL accessible to OutLayer; hosting/publication needs its own authorization. This script does not verify hosted content or availability. Independently verify served bytes and redirects before execution; P2.2 remains open. Determine the top-level `token_storage_deposit` from `storage_balance_bounds().min` of the **same token build and network** (for example an already deployed instance); do not guess it. It is the attached deposit for the payer's direct token `storage_deposit` registering the game account, not a game parameter. Players separately pay `token.storage_deposit` for themselves before calling game `register_token`, which checks `storage_balance_of` without attaching NEAR. Choose resource limits, then obtain testnet `estimate_execution_cost` for each operation and explicitly set deposits, with appropriate margin. Choose compute float separately: `fund_compute` is not included and needs its own authorization. B2 funding is still open.
3. **Configure.** Copy `scripts/deploy/example.json` into gitignored `scratch/deploy/config.json`, then replace **all illustrative values** with reviewed rehearsal inputs, especially paths, SHA-256 in both fields, URL, cap, schedule, limits, all four OutLayer deposits, gas, registration payer and token storage minimum. The example is synthetic, not a quote or measured cost. Amounts are decimal strings in yoctoNEAR or 18-decimal RULE; gas is integer gas, time is integer nanoseconds. The planner enforces callback >= 60 Tgas, OutLayer >= 100 Tgas, mint >= 10 Tgas, each callback-plus-outgoing gas sum <= 250 Tgas, and mint base <= round allowance; these are validation bounds, not testnet measurements. The game token, chain and referee config must match the top-level accounts, hash and testnet. `demo: true` relaxes game schedule bounds and sets the on-chain Demo Mode flag; always label it **Demo Mode - preselected rule** in any display, but this tooling requires the non-demo referee and does not provide a preselected rule. For P2.9 prefer `demo: false` and satisfy the non-demo schedule bounds; keys still remain present. `demo: false` does not make this production.
4. **Prepare offline and inspect.** From the repository root in WSL:

   ```sh
   python3 scripts/deploy/rehearsal.py scratch/deploy/config.json
   cat scratch/deploy/plan.json
   cat scratch/deploy/commands.sh
   ```

   This writes the complete init JSON, hashes and exact commands to gitignored `scratch/deploy/`: atomic token deploy + init, atomic game deploy + init, then direct token registration of the game by the specified payer. The planner revalidates on every invocation; regenerate and inspect if inputs change. It checks local bytes, not balances, account existence, remotely served bytes, chain state or key permissions. Inspect the plan and authorization manually; generated commands are not an authorization.
5. **Only after founder authorization:** `python3 scripts/deploy/rehearsal.py scratch/deploy/config.json --execute`. The script revalidates all inputs, then sends the three actions, stopping at the first error. A later failure leaves a partial deployment: inspect receipts and state, correct the cause and plan recovery deliberately; do not blindly rerun against initialized accounts. Never delete keys here. Confirm the token's live storage minimum matches the configured value and check initialized params, game registration and hashes before use. Account funding and `fund_compute` remain separate actions.
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
