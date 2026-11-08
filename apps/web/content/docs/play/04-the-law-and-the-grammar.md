---
title: The law and the grammar
summary: The finite g1 language, fair-law counts and semantic equivalence.
---

## What a law can say

The locally tested `g1` grammar has 90 atoms, numbered 0–89. A law is one atom, two distinct atoms joined by AND, or two distinct atoms joined by OR. Each atom can be used as stated or negated. Think of an atom as one yes/no question about a play.

Families cover number parity, remainders, thresholds and digits; comparisons with the previous accepted number; word groups, length, initials and the previous word; the UTC minute digit; and the gap since the previous accepted play. A full play includes this context, not just the visible number and word. Find the exact catalog in [/grammar.json](/grammar.json) and the grammar appendix of [/CONTEXT.md](/CONTEXT.md).

## How many laws?

Before filtering, there are at most 180 Single laws and 16,020 each for AND and OR: 90 × 2 + 2 × (90 × 89 / 2 × 4) = 32,220 syntactic laws. The sampler filters by acceptance and whether each literal matters, measured on its fixed sample.

The recorded computation by `crates/rule-core/examples/count_fair_laws.rs` at rule-core commit `d7896679bca5417c9dab51b53e1db0fab09ad2b8` gives 11,790 fair laws: 84 Single, 5,853 AND and 5,853 OR. By bucket these are 2,713 Rare, 3,998 Mid and 5,079 Common.

## Meaning beats wording

Different expressions can mean the same thing over the legal play domain. The referee checks exact semantic equivalence. A free local test can eliminate a candidate contradicted by the loaded ledger, but cannot prove it matches unseen legal plays. See the [solver playbook](/docs/agents/solver-playbook).
