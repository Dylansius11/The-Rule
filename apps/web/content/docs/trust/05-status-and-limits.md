---
title: Status and limits
summary: What was exercised on testnet, what was tested locally and what remains open.
---

## Evidence as of the recorded rehearsal

| Capability | Status | Boundary |
| --- | --- | --- |
| Solo sealed round | Exercised on testnet | r2 Solo 0 settled Solved; CLI replay 52/52 |
| Team sealed round | Exercised on testnet | r2 Team 0 settled Solved with three members; CLI replay 11/11 |
| Browser replay | Locally exercised against testnet views | Solo 0 commitment, 52/52 verdicts and log completeness checked |
| Schedule, season index and keeper | Locally tested with sandbox and mock OutLayer | Not evidence of a deployed keeper or r2 season view |
| Token recovery and failure paths | Locally tested with sandbox and mock OutLayer | Not a testnet proof of all failure schedules |
| Wallet-signed web actions | Not yet exercised on testnet | No claim that signed browser flows completed |
| Demo instance | Not deployed | Separate preselected-rule instance remains planned |
| Season view on r2 | Not available | `get_season` is not deployed on r2 |
| Keeper deployment | Not exercised | Deployed runtime, network and on-time testnet qualification remain open |
| Production freeze and key deletion | Planned | r2 retains keys; it is not creator-blind |

## Important limits

A native transfer may succeed while its callback fails and leaves the withdrawal pending. Remaining-credit play is isolated, but later withdrawal can remain blocked. This residual risk was accepted for testnet only; it is not an established recovery path or production acceptance. Whole-system security review and production recovery or risk acceptance remain open. Testnet NEAR and RULE are play money; no real-value launch is part of this build.
