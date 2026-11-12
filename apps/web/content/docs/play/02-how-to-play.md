---
title: How to play
summary: From a first stamp to a claim, with a real testnet rehearsal.
---

## Stamp and read

Choose [Solo](/play/solo) or [Team](/play/team). At the stamp desk choose a number from 000 to 999 and one of 128 fixed words. Fund game credit first; Team plays use the team vault. Transaction gas is separate.

A new play is pending while the referee works. Only a settled response is YES or NO. A failure refunds the play fee and storage charge and restores the attempt. A previously settled identical play in the same full context is free: it returns the known verdict, with no new row or mint. The minute digit and previous YES affect context, so the same visible number and word need not be a duplicate.

Read the ledger for the complete recorded play context and verdicts. Look for a pattern, including changes in time or the previous accepted play. Export the log for closer inspection.

## Guess in three steps

1. **Write** a candidate from the published grammar.
2. **Commit** the candidate with a secret salt and the quoted stake. Preserve the salt and candidate securely. A candidate that contradicts the ledger can still be committed; it cannot be the rule, so it will not win, and its stake is split as for any wrong guess.
3. **Reveal** the same candidate and salt at least two blocks later, before the deadline. The referee checks the meaning, not just the wording.

The earliest correct commit sequence wins, even if callbacks arrive in another order. After a valid opening, claim the amount owed to game credit; withdrawal to a wallet is a separate action. See [costs and payouts](/docs/play/costs-and-payouts).

## A real rehearsal

On testnet, Solo round 0 on `game-r2.therule.testnet` settled Solved after 52 unique plays. Its final pot was 0.716 NEAR. One wrong and one correct guess were checked; the opened law replayed 52 of 52 verdicts. This was a key-retaining rehearsal, not a production ceremony or a prediction of another round.
