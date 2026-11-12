---
title: Trust model
summary: The parties and assumptions behind the sealed referee, and the limits of replay.
---

## Who is trusted for what

The trust statement shown above identifies the assumptions behind the sealed referee. Intel TDX supplies the trusted execution environment; OutLayer's worker measurements identify approved worker code; the CKD keystore participates in deriving the program-bound key. NEAR and OutLayer availability also matter to operation. A compromise or side channel can affect confidentiality; a replay cannot detect every such failure.

## What the code checks

The game pins the referee hash and has no parameter setters. The planned keyless production deployment has no contract method for deploying code or managing keys. The key-deletion ceremony has not yet happened for production; the exercised r2 rehearsal retains keys. Payouts for a settled round become claimable only after the opening hashes to the stored commitment. Cancelled and Void refunds follow separate paths.

Replay checks consistency and log completeness, not whether anyone learned the law during the round. Contract bugs, infrastructure failures and stalled native-payment callbacks remain risks. See [status and limits](/docs/trust/status-and-limits) and [what replay proves](/docs/trust/what-replay-proves).
