---
title: Frequently asked questions
summary: Practical answers about plays, guesses, funds and the testnet build.
---

## Plays and guesses

### Why can a stamp be free?
A settled duplicate of the same full play context returns its known verdict without a fee or new ledger row.

### Is the same number and word always a duplicate?
No. The minute digit and your previous YES context also matter. The stamp desk says so when the pair was already stamped this round: a repeat in a new context is a new paid play, while a repeat in the same context is free and adds nothing to the pot, the shares or RULE.

### Why 25 attempts?
The Solo base budget is 25 per round, a fixed game parameter. Team starts at 50; eligible RULE locks add attempts subject to caps.

### What does pending mean?
The request has not settled. It is not a YES or NO.

### What if the enclave fails?
A failed play refunds its fee and storage charge and restores its attempt. A failed guess check returns its stake.

### Can I lose my stake?
Yes. A wrong or unrevealed guess returns half its stake and adds half to the pot. Correct and system-failed guesses return the stake. Commit storage is separate.

### What if I clear browser data?
You may lose the locally saved guess and secret salt needed to reveal. Back them up securely before committing; without them the commit cannot be revealed correctly.

### Does matching the ledger prove my guess?
No. Unseen legal plays may distinguish your candidate from the sealed law.

### Can a bot play?
Yes. Bots and agents are welcome and use the same game API.

## Money, trust and access

### What is the storage charge?
It funds retained contract state. The player pays it; it is not platform income. A settled play or commit uses 0.02048 NEAR for action storage on r2; transaction gas is separate.

### Can I withdraw credit?
Yes, subject to contract guards. Withdrawal requires a full-access key and one yoctoNEAR. A stalled native payment callback is an acknowledged testnet liveness risk.

### What happens if a round cannot open?
It can be cancelled after the applicable failure timeout. A hash mismatch makes it Void; the contract has refund paths for these endings.

### What does replay prove?
It checks the opening commitment, the complete log and verdict consistency. It does not prove secrecy during the round.

### Is the rehearsal creator-blind?
No. The r2 rehearsal retains keys. The key-deletion ceremony is planned separately.

### Is the source available?
It is source-available under PolyForm Noncommercial 1.0.0. Commercial use requires permission. See [source and collaboration](/docs/brand/source-and-collaboration).

### Is RULE worth anything?
There is no price, return, liquidity, listing or redemption promise. This build uses testnet play money.

### Is there a demo instance?
Not yet. The planned separate instance must display `Demo Mode - preselected rule`.
