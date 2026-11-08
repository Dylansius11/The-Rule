---
title: Contract reference
summary: Testnet view and action shapes, units, access keys and error codes.
---

## Conventions

Game: `game-r2.therule.testnet`; token: `token-r2.therule.testnet`. `mode` is `0` Solo or `1` Team. NEAR amounts are decimal strings in yoctoNEAR (10^24 per NEAR); RULE amounts are decimal strings with 18 decimals. Timestamps are nanoseconds. Read views at finality `final`; no deposit or signing key is needed. `id` is a round ID, `account` an account ID. All examples below are JSON argument objects; replace illustrative values.

A `play` context has shape `{"number":417,"word_id":0,"minute_digit":4,"prev":{"number":123,"word_id":1,"gap_bucket":0}}`; `prev` may instead be `null`. The word IDs come from `get_word_list`. The minute digit is minute-of-hour modulo 10; the previous play is the entity's last YES. Gap buckets represent under one minute, under one hour, and under 24 hours.

## Views

| Method | Arguments | Return |
| --- | --- | --- |
| `get_params` | `{}` | Fixed deployment parameters, including fees, timing and referee hash |
| `get_round` | `{"mode":0,"id":0}` | Round object or null; `id:null` selects current |
| `get_active_rounds` | `{}` | Nonterminal round objects |
| `get_next_slot` | `{"mode":0}` | `round_id`, `slot_ns` |
| `get_log` | `{"mode":0,"id":0,"from_idx":0,"limit":200}` | Log rows in apply order; max 200 per page |
| `get_verdict` | `{"mode":0,"id":0,"play":{...}}` | Known log row or null, using the complete play object |
| `get_entity` | `{"mode":0,"id":0,"account":"alice.testnet"}` | Attempts, limit, shares, pending and line |
| `get_player` | `{"account":"alice.testnet"}` | Player credit, pending states and team ID, or null |
| `get_commits` | `{"mode":0,"id":0,"from":0,"limit":200}` | Commit rows and statuses |
| `get_team` | `{"team_id":1}` | Team roster, vault and depositor weights, or null |
| `get_claimable` | `{"mode":0,"round_id":0,"account":"alice.testnet"}` | Claimable yoctoNEAR string |
| `get_lock` | `{"mode":0,"round_id":0,"account":"alice.testnet"}` | Locked RULE base-unit string |
| `get_word_list` | `{}` | Ordered array of 128 words |
| `get_ledger` | `{}` | Contract accounting and admission fields |
| `get_token_operation` | `{"request_id":1}` | Pending operation or null |
| token `ft_balance_of` | `{"account_id":"alice.testnet"}` | RULE base-unit string |
| token `get_operation` | `{"operation_id":1}` | Retained operation outcome or null |

`get_season` is not available on r2. A log row contains `log_idx`, `seq`, `play_key`, entity and actor fields, `play`, `verdict` and `minted`. Rows are ordered by callback application, not necessarily by `seq`.

## Actions

FCK means a suitably restricted function-call key, with zero attached deposit. Payable and 1-yocto calls require a full-access key. Credit and vault debits are separate from attached deposit. Outcomes of asynchronous calls require observing the subsequent state or receipt; a request ID alone is not a completed outcome.

| Method and caller | Arguments | Deposit / key | Return or effect |
| --- | --- | --- | --- |
| `deposit_credit`, anyone | `{}` | Payable / full-access | Adds deposit to credit; first deposit pays account storage |
| `withdraw_credit`, owner | `{"amount":"100000000000000000000000"}` | 1 yocto / full-access | Starts withdrawal |
| `play`, player | `{"mode":0,"number":417,"word":"otter"}` | None / FCK | Known verdict or pending request and sequence |
| `commit_guess`, player | `{"mode":0,"hash":"<32-byte-hex>"}` | None / FCK | Commit sequence, sequence, stake and block |
| `reveal_guess`, commit actor | `{"mode":0,"commit_seq":1,"guess":"<canonical-bytes-hex>","salt":"<32-byte-hex>"}` | None / FCK | Referee request ID |
| `claim`, entity member | `{"mode":0,"round_id":0}` | None / FCK | Credits amount owed |
| `claim_team`, stored roster member | `{"mode":1,"round_id":0,"team_id":1}` | None / FCK | Credits historical member reward |
| `create_team`, funded player | `{"name":"ink-club"}` | None / FCK | Creates team, debits team storage |
| `invite` / `remove_member`, captain | `{"account":"bob.testnet"}` | None / FCK | Changes invitation or roster |
| `join_team`, invitee | `{"team_id":1}` | None / FCK | Joins team |
| `leave_team`, member | `{}` | None / FCK | Leaves when roster unlocked |
| `team_deposit`, member | `{"team_id":1}` | Payable / full-access | Adds deposit to vault and member weight |
| `team_withdraw`, depositor | `{"team_id":1}` | 1 yocto / full-access | Credits pro-rata vault principal |
| `settle_team`, anyone | `{"team_id":1}` | None / FCK | Settles terminal principal and releases lock |
| `register_token`, depositor | `{}` | None / FCK | Checks direct token storage registration asynchronously |
| token `ft_transfer_call`, token holder | `{"receiver_id":"game-r2.therule.testnet","amount":"1000000000000000000000","msg":"{\"lock\":{\"mode\":0,\"round_id\":1}}"}` | 1 yocto / full-access | Transfers 1,000 RULE to lock; rejected amount is returned |
| `unlock`, locker | `{"mode":0,"round_id":1}` | 1 yocto / full-access | Starts token return after eligible terminal round |
| `retry_token_operation`, anyone | `{"request_id":1}` | None / FCK | Replays the same pending token operation |

The token account needs standard NEP-145 registration before minting; the user pays it directly. Registration is checked by `register_token`; a YES without confirmed registration does not mint.

## Permissionless lifecycle

The rehearsal also exposes lifecycle calls to any caller with an appropriate function-call key and no attached deposit. `start_round({"mode":0})` starts a due slot, `advance({"mode":0})` moves an expired investigation to Reveal, and `finalize({"mode":0})` sweeps unrevealed commits in batches and eventually requests opening. `retry_open({"mode":0,"round_id":0})` retries an eligible failed opening, `cancel({"mode":0,"round_id":0})` applies an eligible timeout cancellation, and `expire_request({"request_id":1})` expires an eligible stalled referee request. Consult current round state and deadlines before acting; a request is not a completed transition.

## Commit encoding and errors

The guess commitment is SHA-256 of these concatenated bytes: ASCII `the-rule/commit/v1`; chain ID and game account, each UTF-8 prefixed by its byte length as `u32` little-endian; mode as `u8`; round ID as `u32` little-endian; actor as another length-prefixed UTF-8 string; entity tag as `u8` (Solo `0`, Team `1`) and entity ID as `u32` little-endian; canonical guess bytes; and 32 salt bytes. Solo's entity ID is the player's interned `get_player.index`; Team uses the team ID.

Canonical guess bytes are ASCII `g1`, then form `u8` (`0` Single, `1` AND, `2` OR), literal count `u8`, then each `(atom_id u8, negated u8)` pair in sorted order. Use the shared protocol implementation and vectors rather than inventing encodings. Persist the exact bytes and salt securely.

| Code | Meaning |
| --- | --- |
| E10 | Wrong phase |
| E11 | Invalid input |
| E12 / E13 / E14 | Same combination pending / entity pending / attempt limit |
| E15 | Three open commits already |
| E16 / E17 / E18 / E19 | Reveal deadline / wrong actor / too early / commitment mismatch |
| E20 / E21 / E22 / E23 / E24 | Insufficient credit or vault / withdrawal guard / compute / referee capacity / operator collateral |
| E30 / E31 / E32 / E33 | Roster locked / team full / no team / authorization or invitation |
| E50 / E51 / E56 / E57 | Transition not due / one yocto required / nothing to claim / registration pending |
