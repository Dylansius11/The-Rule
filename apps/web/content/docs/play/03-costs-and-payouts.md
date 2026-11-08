---
title: Costs and payouts
summary: Testnet fees, stakes, contributor shares and exact payout examples.
---

## A paid play

The following are fixed parameters of the exercised r2 testnet deployment; gas is separate. One NEAR is 10^24 yoctoNEAR. Storage charges fund retained contract state; they are paid by players and are not platform income or pot money.

| Item | NEAR | Destination |
| --- | --- | --- |
| Play fee | 0.01 | 0.008 pot, 0.0015 compute, 0.0005 platform |
| Play storage | 0.02048 | Storage reserve; non-refundable on a settled play |
| Total | 0.03048 | Fee plus storage |

A failed referee play refunds both charges. A settled duplicate in the same context has no charge. The first credit deposit also pays 0.00512 NEAR account storage; creating a team pays 0.02048 NEAR team storage. Token registration and transaction gas are separate.

## Guess stakes

| Mode | Stake fixed at commit | Additional commit storage |
| --- | --- | --- |
| Solo | Greater of 0.1 NEAR and 1% of current pot | 0.02048 NEAR |
| Team | Greater of 0.1 NEAR and 2% of current pot | 0.02048 NEAR |

Correct returns the stake separately from rewards. Wrong or unrevealed returns 50% and adds 50% to the pot; a system failure returns the entire stake. Commit storage is not refunded. At most three commits per entity may be open; reveal at least two blocks after committing.

## Pot split

| Outcome | Winner | Contributors | Rollover | Platform |
| --- | --- | --- | --- | --- |
| Solved | 40% | 40% | 10% | 10% |
| Unsolved | 0% | 40% | 50% | 10% |

Each unique settled paid play earns one contributor share, YES and NO alike, up to 25 per Solo entity or 50 per Team entity per round. The contributor pool divided by total shares, rounded down to yoctoNEAR, gives the per-share amount. Team rewards split equally among the stored roster; rounding dust rolls over. With no shares, the contributor pool also rolls over.

## Worked example

Illustration, not a forecast: a solved pot of 1 NEAR with 10 shares allocates 0.4 NEAR to the winner, 0.4 to contributors, 0.1 to rollover and 0.1 to the platform. Each share receives 0.4 / 10 = 0.04 NEAR. A winner with two shares receives 0.4 + 2 × 0.04 = 0.48 NEAR, plus the separately returned correct stake. A wrong 0.1 NEAR stake returns 0.05 and adds 0.05 to the pot; that addition must already be included in the final pot before applying the split.

Contributing is rarely profitable unless a large rollover is shared by relatively few plays. A share is not a promise of a return; the 0.03048 NEAR play cost and gas still apply.
