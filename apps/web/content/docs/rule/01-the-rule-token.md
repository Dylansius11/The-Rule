---
title: The RULE token
summary: Testnet play money, mint authority and 18-decimal units.
---

## What RULE does

RULE is an NEP-141 token used as testnet play money in this build. Eligible YES verdicts can mint it; locking it can increase the attempt budget for a round. Extra attempts still pay the normal play fee and storage charge. RULE has 18 decimal places, so one whole RULE is `1000000000000000000` base units.

## Supply and authority

The game's account is the immutable minter. There is no pre-mint. Each mode and round has a 500,000 RULE mint allowance on r2; issuance is limited by the remaining allowance and the token's cap. Unused round allowance expires. Supply can also decrease through a standard token resolver burn; pending intended mints are not confirmed supply.

Players must pay token storage registration directly and have it confirmed by the game's `register_token` before an eligible YES can mint. See [minting](/docs/rule/minting) and [locking](/docs/rule/locking-for-attempts).
