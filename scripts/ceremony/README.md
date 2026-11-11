# Production deploy and key-deletion ceremony (P8.2)

`ceremony.py` runs the four steps of "Key-deletion ceremony" in [SMART-CONTRACT](../../docs/technical/SMART-CONTRACT.md) for `game.therule.testnet` and `token.therule.testnet`. It is testnet-only. Status: planned and locally tested with a fake chain; **not yet run against the production accounts**. Run it from the repository root in WSL, where `near-rule` and its isolated keychain live.

## Inputs

- A deploy config with `deployment_kind: "production"`, `demo: false`, and the reviewed artifacts. Format: [`scripts/deploy/example.json`](../deploy/example.json). Its planner (`scripts/deploy/rehearsal.py`) validates it and refuses `--execute` for production.
- A ceremony config (no secrets):

```json
{
  "deploy_config": "scratch/ceremony/deploy-config.json",
  "rpc_urls": ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"],
  "min_balance_yocto": {"game": "<yocto>", "token": "<yocto>", "payer": "<yocto>"}
}
```

The accounts must already exist and be funded. Creating and funding them is a separate step that needs the founder's authorization.

## Order

1. `ceremony.py CONFIG plan` writes `scratch/ceremony/plan.json`. Offline. Requires the first slot (`genesis_ns`) to be at least 2 h 10 min away.
2. `ceremony.py CONFIG preflight` is read-only: both accounts exist and hold no code, balances meet the minimums, and every referee URL serves bytes with the planned sha256.
3. `ceremony.py CONFIG execute --step deploy` prints the four commands. Add `--execute --confirm "deploy game.therule.testnet token.therule.testnet"` to send them: token deploy and init, operation funding, game deploy and init, game registration on the token.
4. `ceremony.py CONFIG execute --step delete-keys` lists the live keys and prints one atomic delete-keys transaction per account. **Irreversible.** It sends only with `--execute --confirm "delete-keys game.therule.testnet token.therule.testnet"`, and only if the live code hash and `get_params` match the saved plan and the game is registered on the token.
5. `ceremony.py CONFIG verify` is read-only. PASS needs empty key lists for both accounts, the planned code hashes, the planned params, `demo` false, and the first slot still in the future. It writes the block hash and height to `scratch/ceremony/evidence.json`. This proves empty key lists at that block. It does not prove the rule stayed secret.

`keys ACCOUNT` prints one account's current access keys.

## Notes

- Steps 4 and 5 use the saved plan, not a fresh one, because after the deploy the first slot is closer than the planner's 2 h bound.
- Live `get_params` returns fields that init does not carry (`demo`, `user_referee_request_limit`, `max_pending_referee_requests`), so `verify` compares the planned keys, not the whole object (observed 2026-11-11 on `demo-game.therule.testnet`).
- `drpc` answers 403 to Python's default user agent; the client sends its own.
- One transaction per account deletes every key, the signing key included, so a failure cannot leave the account half locked. [V, local nearcore sandbox, 2026-11-11] A throwaway rehearsal gave an account a function-call key, then one batch transaction signed by the account's own key deleted both keys: 2 keys before, 0 after. This used near-workspaces, not `near-rule` or testnet, so the first `near-rule account delete-keys` run on testnet is still the first test of that exact CLI path.
- Tests: `python3 -B -m unittest discover -s scripts/ceremony -p test_ceremony.py -v`.
