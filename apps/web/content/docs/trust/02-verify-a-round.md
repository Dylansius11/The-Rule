---
title: Verify a round
summary: Check the opening, verdicts and log, then compare the pinned referee build manually.
---

## Browser Verify

Open the Verify tab for a settled round. The browser checks three things: the revealed law and salt hash to the round commitment; every logged verdict matches the revealed law; and the retrieved log is complete. Read all three results, including the row count. Browser replay of r2 Solo round 0 was locally exercised against live testnet views: 52 of 52 verdicts matched.

## Command line

From the repository root in WSL, the existing read-only verifier target accepts a mode and round ID:

```sh
make verify ROUND=solo/0
make verify ROUND=team/0
```

The recorded testnet rehearsal used this target to check 52/52 Solo and 11/11 Team verdicts. The command defaults to the r2 game and testnet RPC; `GAME_ACCOUNT` and `NEAR_RPC_URL` can select another testnet account or RPC. Do not treat an incomplete or failed result as a pass.

## Compare the referee manually

Read `get_params.referee.hash` from the deployment and compare it with the SHA-256 of a reproducible referee build for that exact game account and source. The build recipe is `scripts/referee/build-reproducible.sh`; account binding matters. A matching hash checks the bytes being compared, not enclave secrecy or quote authenticity. See [replay limits](/docs/trust/what-replay-proves).
