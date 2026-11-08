---
title: Keyless and the ceremony
summary: Planned production key deletion, the key-retaining rehearsal and the demo label.
---

## The planned ceremony

The plan is to freeze and publish the builds, deploy fresh game and token contracts, delete every access key on those accounts, and record both deletion transactions and empty key lists before the first round seed. The ceremony is planned, not yet completed for production. The contract has no method to deploy code or manage account keys.

The exercised `game-r2.therule.testnet` rehearsal retains keys. It uses a compressed-schedule flag with a non-demo referee and is not creator-blind. Do not infer a preselected law from that scheduling flag.

## Demo and future fixes

A separate demo instance is planned, not deployed. It must always be labeled exactly `Demo Mode - preselected rule` and must never be called creator-blind.

After production key deletion, a code fix requires a new deployment rather than an upgrade to the keyless contracts. Old rounds remain independently verifiable from their recorded data. See [verify a round](/docs/trust/verify-a-round).
