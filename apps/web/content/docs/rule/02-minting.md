---
title: Minting RULE
summary: Allowance decay, bucket multipliers and pending token operations.
---

## Formula

For an eligible YES on the exercised r2 parameters, the intended amount is `100 RULE × allowance_left / round_allowance × bucket`, calculated using integer base-unit arithmetic and capped by remaining allowance. The round allowance starts at 500,000 RULE per mode; unused allowance expires at round end.

| Bucket | Multiplier |
| --- | --- |
| Rare | 100% |
| Mid | 50% |
| Common | 25% |

For example, with 250,000 RULE of a 500,000 RULE allowance left, the ratio is 0.5. The intended mint is 100 × 0.5 × 1 = 50 RULE for Rare, 100 × 0.5 × 0.5 = 25 RULE for Mid, or 100 × 0.5 × 0.25 = 12.5 RULE for Common. These are alternative examples from the same starting allowance. After a confirmed 50-RULE Rare mint, 249,950 RULE remains available, so the next eligible mint uses the smaller ratio.

## Pending is not minted

Token registration must be paid directly and confirmed first. A YES remains a YES even if minting fails. A pending operation reserves allowance and may appear in the log as intended issuance; it is not confirmed supply. An authenticated rejection restores the reservation, while an unknown outcome stays pending and can be replayed using the same operation ID without applying the effect twice. Recovery behavior was locally tested; see [status](/docs/trust/status-and-limits).
