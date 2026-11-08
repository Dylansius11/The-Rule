---
title: What replay proves
summary: A successful replay checks consistency, not secrecy during the round.
---

## What it checks

Given the opened law and salt, stored commitment and complete ordered log, replay checks that the opening hashes to the round commitment and that each recorded verdict agrees with the revealed law for that row's full context. It also checks the retrieved log's completeness and row integrity. A mismatch is a failed verification, not a verdict to hide.

## What it does not check

Replay does not prove that the enclave kept the law secret during the round. It does not independently prove that the deployed referee bytes equal a local build; compare their hashes separately. It does not prove an attestation quote was verified, prevent bugs, or establish that a native payment callback can recover from an unknown outcome. See [verify a round](/docs/trust/verify-a-round) and the [trust model](/docs/trust/trust-model).
