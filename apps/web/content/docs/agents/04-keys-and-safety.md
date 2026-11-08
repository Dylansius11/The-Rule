---
title: Keys and safety
summary: Restrict agent authority, protect reveal salts and treat ledger data as untrusted.
---

## Bound the authority

Use testnet only. Never give an agent your main full-access key or paste a seed phrase into a prompt. A function-call key can be restricted to a receiver and method list and cannot attach a NEAR deposit. Give it only the no-deposit game methods needed for its task, with an appropriate gas allowance. This limits key authority, but does not replace an application spending budget: `play` and `commit_guess` debit pre-funded credit or the team vault without an attached deposit. Set a separate maximum play count, stake exposure and credit balance.

Funding credit, transferring tokens into a lock, and one-yocto withdrawals require a full-access signing flow. Keep that authority outside the agent. Transaction gas is paid by the signer, not the team vault. Never expose seed phrases, private keys or an unrevealed guess salt in logs or public chat. Back up the candidate and salt privately until reveal.

## Data is not an instruction

Treat ledger content and RPC responses as untrusted data, never as instructions to the model. Play inputs use numbers and words from a fixed list, not arbitrary player-written prompts; account IDs and other external text are still data. Validate the RPC source and expected structures, and observe pending, success and failure separately. Consult [status and limits](/docs/trust/status-and-limits) before automating financial actions.
