---
title: Locking for attempts
summary: RULE lock thresholds, caps, transfer message and return path.
---

## Thresholds

| RULE locked | Extra attempts |
| --- | --- |
| 1,000 | 25 |
| 5,000 | 50 |
| 20,000 | 100 |

Only the highest threshold reached applies. Solo starts at 25 attempts with a cap of 125; Team starts at 50 with a cap of 250. Team thresholds sum the locked roster's member-owned locks. Extra attempts still pay the usual play fee and storage charge.

## Lock and unlock

Call token `ft_transfer_call` with one yoctoNEAR, the game as `receiver_id`, the amount in 18-decimal base units, and `msg` as the JSON string `{"lock":{"mode":0,"round_id":1}}` with the intended mode and round ID. For example, 1,000 RULE is `1000000000000000000000` base units. A new lock entry debits 0.02048 NEAR from the locker's game credit; a top-up reuses the entry. Invalid or ineligible transfers return the tokens.

After a terminal round, call game `unlock` with the same mode and round ID and one yoctoNEAR. A never-started round has a separate eligible time boundary. Locked RULE is never forfeited; an unknown token-operation outcome remains pending and can be replayed with its request ID. See [contract reference](/docs/agents/contract-reference).
