---
title: Rounds and seasons
summary: Lifecycle, planned production timing and the separate r2 rehearsal schedule.
---

## From seal to settlement

```text
Scheduled -> Sealing -> Investigation -> Reveal -> Opening -> Settled
                 |                                   |-> Void
                 |-----------------------------------> Cancelled (on failure)
```

Anyone can call the permissionless lifecycle methods; a keeper is planned to do so. During Investigation, players make plays and commit guesses. A correct guess freezes new plays and commits; otherwise investigation ends at its deadline. Existing commits may reveal before the reveal deadline. Opening checks the revealed law against the commitment before settlement and payouts. Failure can lead to cancellation; a commitment mismatch leads to Void.

## Two schedules, not one

| Parameter | Planned production | Exercised r2 testnet rehearsal |
| --- | --- | --- |
| Period per mode | 24 hours | 24 hours |
| Investigation maximum | 23 hours | 2 hours |
| Reveal window | 30 minutes | 10 minutes |

The rehearsal retains keys and uses a compressed-schedule exception with the non-demo referee; it is not creator-blind. See [ceremony](/docs/trust/keyless-and-the-ceremony).

## Seven-round seasons

A planned season covers seven numbered slots per mode. Solo and Team have separate rounds and boards. Season indexing has local test evidence but is not deployed on r2: `get_season` is unavailable there. The [season page](/season) must not present a missing board as live results.
