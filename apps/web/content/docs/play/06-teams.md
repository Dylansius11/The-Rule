---
title: Teams
summary: Share a vault, a line and an attempt budget with up to five members.
---

## Assemble the roster

A funded player creates a team, the captain invites accounts, and invitees join. A team has at most five members. The captain's crew desk shows the team id with an invite link (`/play/team/crew?join=<id>`). The link only fills in the team id and shows who is on the team: it admits nobody, because the captain must also invite the account name, and the desk tells an uninvited visitor which name to send. The first funded participation snapshots the roster and locks it through the round; a fully refunded provisional first play can release an otherwise unused snapshot.

## One team, one line

Members fund the vault, which pays team play fees, storage and guess stakes. Each signer still needs wallet NEAR for transaction gas. A team shares one previous-YES line, one pending play and one attempt budget. Its base is 50 attempts, with eligible member locks adding attempts up to the 250 cap. Each extra play still costs the normal fee.

Winner and contributor rewards split equally among the stored round roster, with rounding dust rolling over. After a team round ends, the crew desk's "After the round" card has two separate signatures. **Unlock team** returns the team's correct stakes to the vault and reopens deposits, invites and leaving; the contract lets any account call it. **Claim my reward** puts your equal share in game credit. Vault principal is different: after terminal settlement, each depositor withdraws their pro-rata remaining vault position to personal credit, then may withdraw credit to their wallet. Historical members can claim their stored round entitlement even after leaving; keep the original team and round IDs, which the card's "Use another round or team" section accepts. The Team flow was exercised in a three-member testnet rehearsal. Visit [Team](/play/team).
