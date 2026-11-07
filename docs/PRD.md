# THE RULE: product requirements

## TL;DR

- **One-liner:** A memecoin with a secret law that nobody knows, not even its creators. Find the rule, win the pot.
- **Status (2026-11-07):** Phase 2/3 testnet acceptance is complete. Fresh `game-r2`/`token-r2` completed a Solved real-OutLayer Solo round with 52 unique settled plays, one Wrong and one Correct guess, matching open, verifier PASS 52/52 and fully reconciled claims/native payouts. The r2-bound non-demo referee reproduced twice and is published on Cloudflare/FastFS; deployed hashes/params and final cash/token/collateral passed independent checks. Original tests/counts are unchanged; the founder explicitly accepted native stalled-callback residual risk **only for testnet** (D31), not as recovered or production-safe. Production recovery/risk acceptance, B6, freeze and key deletion remain open. No keyless launch, secrecy proof or preselected-rule demo is claimed; visuals wait for B1.
- **Withdrawal isolation (D34/D35):** pending withdrawal no longer owns the play guard; remaining credit can fund experiments while the exact withdrawn principal stays reserved. Actual local transfer-success/callback-failure isolation passed, and the new Player layout is deployed to fresh r2 state, never over r1. Successful rehearsal payments do not establish recovery of a failed native callback; that residual liveness/architecture gate remains explicit.
- **Event:** NEAR HACKATHON 2026, memecoins track primary, games secondary. Submission closes **2026-11-14T23:59:00Z** ([V](https://nearhackathon.com/HACKATHON.md), captured 2026-10-22). THE RULE is the founder's second, independent entry. The first is CONSTITUTION, and each README must name the other.
- **Primary success condition:** one real sealed round on NEAR testnet goes end to end. Plays get enclave verdicts, YES mints RULE, a correct commit-reveal guess wins the pot, the rule and salt open, and the browser replays every verdict against the day-1 commitment. One labeled Demo Mode round is recorded for the video.
- **Kill rule:** if Phase 0 gates T1, T2 or T3 fail (BUILD-PLAN), THE RULE is dropped. It is never downgraded to a plain commit-reveal quiz.

## Problem, users and buyer

**Problem [I].** In memecoins and hidden-rule games, the insider is the problem. Creators know things players don't. A hidden-rule game host knows the answer and can play through another account. A salted hash commitment stops the host from *changing* the answer, but not from *knowing* it ([sources/27](#sources-and-glossary) section 2.1).

| User | Job | What they need from us |
| --- | --- | --- |
| Players (humans) | Run cheap experiments, spot the pattern, win the pot, earn RULE | A fast play loop, a readable public log, clear stakes and payouts, proof the game was fair |
| Agent builders | Point a model or solver at a fresh, uncontaminated induction task with real stakes | The same contract API as humans, a restricted function-call key, exportable log, machine-readable grammar |
| Spectators | Watch humans and models race to crack a sealed law | Live round state, the public log, a reveal moment |
| Judges (7 humans + Claude Code + Codex) | Verify the claim in minutes | `make verify`, a README with "do X - see Y", real testnet receipts, honest limits |

There is no paying buyer at hackathon scale. The protocol earns only the platform share (5% of fees + 10% of each round pot), in testnet NEAR.

## Insight and necessity

**Mechanism [I].** Each round, a hash-pinned OutLayer program running in Intel TDX derives one rule from a sealed key plus a chain seed. The key is bound to the program hash and the game contract (`bind:"wasm"`, `caller:"predecessor"`). The seed is drawn after the game account's keys were deleted. Only `sha256(rule || salt)` goes on chain. Players pay per play and get YES or NO. YES mints RULE from a capped allowance that expires with the round. Fees fund a NEAR pot. A correct semantic guess, committed then revealed and checked for exact equivalence inside the enclave, wins the pot. Then the rule opens and every verdict replays in the browser.

| Primitive | Why it is load-bearing | What breaks without it |
| --- | --- | --- |
| OutLayer TEE + wasm-bound, predecessor-bound key | The only party that can compute the rule is a pinned program, not a person | The creator knows the rule, and we are back to a plain quiz (kill condition) |
| Keyless game contract | No one can upgrade, drain or query as the game | The creator could query the referee as the game account |
| NEAR contract custody | Pot, stakes and payouts follow fixed formulas nobody can switch off | Trust a server operator with the pot |
| NEP-141 RULE with expiring allowance | Issuance reacts to how often the community is right: the memecoin mechanic | A points game, weaker memecoins-track fit |
| One shared Rust `rule-core` | The same evaluator runs in the enclave, the contract and the browser | Replay could disagree with the referee for reasons other than cheating |

**When a simpler solution wins [I]:** if the operator-blind claim is not needed, a normal web game with a server is faster and legally simpler. THE RULE exists only because operator blindness is real. That is why Phase 0 is a kill test.

## Trust claim and its limits

Use this wording, and only this wording, everywhere (PRD, README, video, UI):

> "The deployed program does not disclose the rule before the authorized reveal, under the stated TEE trust model (Intel TDX, OutLayer worker measurements, the CKD keystore)."

- **Proved after a round:** the revealed rule and salt hash to the commitment published at round start. Every logged verdict equals the revealed rule applied to that play. The deployed referee bytes have the pinned hash.
- **Not proved:** that the enclave kept the rule secret during the round. A passive TDX or keystore leak would be undetectable. Replay consistency does not prove secrecy.
- **Never say:** "nobody can ever know", "unhackable", "provably fair", "not even Intel can know". Demo Mode is never called creator-blind.
- **Money:** testnet play money only. No price, return, redemption or liquidity promise for RULE. A real-value launch needs legal review [U].

## Never-cut demo

1. Show the live round strip: mode, "sealed 3 h ago", commitment hash with block link, pot, plays so far.
2. Play `417 otter` and get NO ("fee joined the pot"). Play `418 heron` and get YES (+RULE minted). Show both receipts.
3. Pick a combination another player already tried in the same context: "Already tried: NO". Nothing is charged and no log row is added.
4. Filter the public log (even numbers), export JSON, and hand it to an LLM agent with the same function-call key rights as a human.
5. A wrong guess: the stake is split 50% back, 50% to the pot, and there is no hint.
6. A correct guess commit, then reveal. The round freezes. A later identical copy loses on commit order.
7. Reveal: the rule types out. The browser shows "commitment matches" and "N of N verdicts match". `make verify ROUND=...` prints the same in a terminal.
8. Claim: the winner gets 40%, contributors get 40% by unique plays, 10% rolls over, 10% goes to the platform. Show the receipts.

Steps 1 to 4 and 7 use a **real sealed production round**. Steps 5, 6 and 8 may use the **Demo Mode** round, labeled "Demo Mode - preselected rule" on screen at all times.

## Features

Priorities follow the founder's MVP build order (D23): cut from the bottom, and tell the founder before cutting. Ids map into BUILD-PLAN.

### Order 1: sealed round core

| Id | Feature | Inputs, outputs, states, rejections | Acceptance and proof surface |
| --- | --- | --- | --- |
| F1 | Sealed round start | Keeper or anyone calls `start_round(mode)` at slot time. The referee `begin` returns the commitment and header. States: Scheduled, Sealing, Investigation; begin failure past timeout leads to Cancelled | Testnet tx with commitment stored; seed block after the key-deletion block |
| F2 | Play and verdict | `play(mode, number 000-999, word from 128 list)`; time context from block. Output YES/NO via callback. Rejections: E10 to E14, E20, E22, E23 (capacity, nothing charged). Failure refunds in full | Receipts for YES and NO; refund receipt for a forced failure on rehearsal |
| F3 | Duplicate play | Same full combination: "Already tried: YES/NO". No fee, no enclave call, no mint, no share, no log row | Sandbox T-PLAY-4; UI pre-check via `get_verdict` |
| F4 | Public log | Paged contract view; client-side search and filter by number, word, result, player; CSV and JSON export of all filtered rows | Export of a real round matches `get_log` row count |
| F5 | Final guess | `commit_guess(hash)` any time in Investigation; `reveal_guess(guess, salt)`; exact semantic check in the enclave; earliest correct commit wins; freeze stops new plays and commits | Sandbox T-GUESS; testnet correct guess with different syntax from the rule |
| F6 | Reveal and replay | `finalize` then referee `open`; on-chain hash check; Settled or Void. Browser and CLI replay of every verdict and the commitment | `make verify ROUND=<mode>/<id>` PASS on a real round; same result in the browser |
| F7 | Equivalence checker | `rule-core::equivalent(a, b)` over the full legal domain via per-group reachable signatures; no sampling | Differential test vs brute force, 1e5 pairs, 0 mismatches; full-domain wasm run < 10 s (P1.3) |

### Order 2: pot, fees and stakes

| Id | Feature | Contract | Acceptance |
| --- | --- | --- | --- |
| F8 | Play credit | `deposit_credit`, `withdraw_credit` (1 yocto, full-access key only). Plays and stakes are paid from credit, because function-call keys cannot attach NEAR | Sandbox; testnet deposit and withdraw receipts |
| F9 | Fee split | 0.01 NEAR: 80% pot, 15% compute float, 5% platform; separate storage charge per play | T-INV-1, T-PAY |
| F10 | Stakes | Solo 1%, Team 2% of the pot at commit, minimum 0.1 NEAR, locked at commit. Correct: returned. Wrong or unrevealed: 50% back, 50% to the pot. System failure: 100% back | T-GUESS |
| F11 | Payouts | Solved: 40 winner / 40 contributors / 10 rollover / 10 platform. Unsolved: 40 contributors / 50 rollover / 10 platform; no contributors means rollover. Pull-based `claim` | T-PAY, testnet claim receipts |
| F12 | Contributor shares | Every settled paid play is the first of its combination (duplicates are free and unrecorded), so it earns one share. YES and NO are equal. Capped per entity per round | T-PAY property |
| F13 | Failure and cancel path | Any failed enclave call refunds in full. A round that cannot begin or open in time is Cancelled with exact refunds. A hash mismatch is Void | T-ROUND, T-CB |

### Order 3: team mode

| Id | Feature | Contract | Acceptance |
| --- | --- | --- | --- |
| F14 | Teams | Create, invite, join, leave; max 5; roster locked from first team action in a round until it ends | T-TEAM |
| F15 | Team vault | Members deposit; plays and team stakes paid from the vault; each depositor recorded; unused balance withdrawn pro rata between rounds | T-TEAM-3 property |
| F16 | Team play | Separate Solo and Team rounds, each with its own rule, log and pot; one shared attempt limit and one line per team; winner and share payouts split equally among members | Sandbox; testnet team round |

### Order 4: RULE token

| Id | Feature | Contract | Acceptance |
| --- | --- | --- | --- |
| F17 | RULE NEP-141 | NEP-141, NEP-145, NEP-148 metadata; only `game` can mint; hard cap; no pause, tax, blacklist or transfer hook | T-TOK; transfer during an open round |
| F18 | Mint on YES | `m = 100 * allowance_left / allowance * bucket`; allowance expires at round end. An authenticated token rejection restores it; unknown transport retains a permissionlessly replayable reservation | T-INV-3; after reconciliation, supply equals logged mints minus standard resolver burns |
| F19 | RULE lock for attempts | `ft_transfer_call` locks RULE for a Scheduled round; tiers add attempts up to a hard cap; extra attempts still pay the fee; returned after the round; never forfeited | T-LOCK |

### Order 5: Demo Mode and schedule

| Id | Feature | Contract | Acceptance |
| --- | --- | --- | --- |
| F20 | Round schedule and seasons | One round per day per mode (max 24 h, ends early when solved); 7-round seasons with Best Individual and Best Team boards; permissionless keeper | Keeper heartbeat; on-time `start_round` receipts |
| F21 | Demo Mode | Separate demo instance (own contracts, pot and token) using a demo referee build with a preselected rule; compressed clock; Reset Demo; always labeled | Demo round recorded; label visible in every frame |

### P1, only after all P0 gates pass

| Id | Feature | Note |
| --- | --- | --- |
| F22 | Passkey sign-in (NEAR Auth) + function-call key | 3-hour timebox. Fallback: guest key + NEP-366 relayer, labeled. SDK depends on older near-api-js (D2 risk) |
| F23 | House bots and one recorded LLM agent | Random, enumerator (the benchmark baseline), one LLM agent; labeled "house" |
| F24 | Humans-vs-models leaderboard | Same season data, entity labels self-declared |
| F25 | Agent kit | CLI + MCP tools over the same views and methods; machine-readable grammar JSON |

### Future, documented, not built

DAO voting over unsolved pots; play-fee discounts (replaced by RULE lock, D16); on-chain single-play `challenge`; Lens hints (burn RULE); account-property atoms; Week and Finale tiers; batching; sponsored benchmark rounds; mainnet or any real-value launch (legal review first).

## Functional screen contracts (no visuals)

Visual design is blocked on founder references (B1). These contracts fix only what the user can do, what the screen shows and which contract call it makes. Every action shows real pending, success and failure states. No fixture data is ever shown as live.

| Screen | User can | Shows | Calls |
| --- | --- | --- | --- |
| S1 Play | Pick mode (Solo/Team); pick number and word; stamp; see the verdict or "already tried" | Round strip (mode, phase, commitment, sealed-ago, pot, plays, accept rate); own line; attempts left; credit; live time context (UTC minute digit, gap since last YES) | `get_round`, `get_entity`, `get_verdict` (pre-check), `play`, poll `get_entity` until settled |
| S2 Log | Search and filter by number, word, result, player; sort; export CSV/JSON of filtered rows; open a play | Virtualized log, filter accept rates, completeness indicator (loaded rows / total) | `get_log` paged at `final` |
| S3 Guess | Build a guess from the published atoms; check it against the log locally (wasm); commit; reveal; see the result | Stake quote locked at commit; commit hash; reveal deadline; status Committed, Checking, Correct, Wrong, Refunded | `get_round`, `commit_guess`, `reveal_guess`, `get_commits` |
| S4 Reveal and verify | Watch the reveal; run browser replay; copy the `make verify` command; download the log | Rule in English, DSL and canonical JSON; salt; commitment check; N of N verdicts match; winner; payouts | `get_round`, `get_log`, wasm `verify_round` |
| S5 Team | Create, invite, join, leave; deposit to and withdraw from the vault; lock RULE | Roster, lock state, vault balance and depositor weights, team attempts | team methods, `team_deposit`, `team_withdraw`, `ft_transfer_call` |
| S6 Wallet and claims | Connect; deposit/withdraw credit; lock/unlock RULE; claim payouts; retry pending RULE operations | Available credit; separate play, Checking-guess and withdrawal pending states; RULE balance, locks, claimable; distinct pending/applied/rejected token operation status and recovery action. A pending payment is not a verdict and its principal is not available credit | `get_player`, `deposit_credit`, `withdraw_credit`, `claim`, `unlock`, `get_token_operation`, `retry_token_operation`, token `get_operation` |
| S7 Season | Browse Solo and Team boards | Rounds won, shares, earnings per entity | `get_season` |
| S8 Demo toggle | Switch between the real sealed round and Demo Mode | A permanent "Demo Mode - preselected rule" label in demo; Reset Demo for the operator | Points the client at the demo contracts |

## Economics summary

All numbers are params fixed at deployment (SMART-CONTRACT, Params). They are illustrative testnet settings, not forecasts. Pot conservation holds in every branch: `pot = winner + contributors + rollover + platform`, with dust going to rollover. Compute float, storage charges, stakes and credit are separate ledgers.

- **Per play:** 0.01 NEAR fee (0.008 pot, 0.0015 compute float, 0.0005 platform), plus the production action-storage floor of 0.02048 NEAR (2,048 bytes). Account and Team floors are 512 and 2,048 bytes. These local bounds are not a final deploy quote. A separate nonrefundable token budget funds each permanent mint/unlock outcome at a 256-byte live storage quote (currently 0.00256 NEAR); it is not taken from player credit, registration deposits, pot or compute. Deployment must explicitly budget this lifetime cost and monitor available funding.
- **Compute check [V, live views 2026-11-04]:** OutLayer base 0.001 NEAR + 0.0000001 NEAR per requested ms, so a 5 s verdict limit attaches about 0.0015 NEAR before refunds. The 15% compute share is tight. If T4 shows actual cost above about 0.0012 NEAR per verdict, the split moves to 80/10/10 or the limit drops (D3).
- **Who earns:** the solver (40% + its own shares), every unique play (40% shared), the next round (10% or 50%), the platform (5% of fees + 10% of the pot).
- **Spam does not pay:** each share costs at least 0.01 NEAR, of which 0.008 goes to the pot. A share pays at most `0.4 * pot / shares`. Contributing is profitable only when a large rollover is shared by few plays, which is the intended jackpot incentive and is public.
- **Issuance:** at most `round_allowance` per mode per round; unused allowance expires. Log mint amounts reserve intended issuance while a token operation is pending. After reconciliation, logged issuance equals token supply plus any standard resolver burns; a YES verdict never masquerades as a confirmed mint.

## Non-goals and scope cuts

Not in this product: NEAR AI Cloud as referee (an LLM breaks exact equivalence); NEAR Intents and Chain Signatures; trading, liquidity, DEX listing or any RULE value promise; human-only leagues or anti-bot claims (bots and AI are welcome); mainnet; real-value prizes.

Cuts follow the founder's build order from the bottom (D23), and the founder is told before each one: F21 Demo Mode (the video then shows a real round only), then F20's automatic keeper (manual `start_round` calls instead), then F19 RULE lock, then F17 and F18 RULE token, then F14 to F16 Team mode. F1 to F13 are never cut. If they cannot ship, the entry is not submitted.

## Success and business essentials

- **Measured:** real rounds completed, plays, unique players, guesses, time to solve, RULE minted vs allowance, replay PASS. All come from chain data. No traction is invented.
- **Operating cost [I]:** OutLayer compute per verdict (T4), testnet gas and storage, a free static host, a free or small keeper host. Cost on testnet is zero real money.
- **Distribution [I]:** NEAR meme communities (THREE, HOOT, BLACKDRAGON, SHITZU, WTH) only for conversation, never as endorsement claims or purchases ([sources/31](#sources-and-glossary)).
- **Next 90 days, if continued:** measure human vs bot solve times; legal review before any real value; Week tier; DAO over unsolved pots.

## Evaluation and evidence

Rubric weights for this event are UNVERIFIED. Past NEAR guide: technical implementation, design, impact, originality, sustainability.

| Criterion | Evidence artifact |
| --- | --- |
| Technical | Testnet receipts, `make verify`, key-deletion ceremony proof, invariant tests |
| Design | Never-cut demo flow, real pending and failure states (visuals after B1) |
| Impact | The insider problem removed for one game class, under a stated trust model |
| Originality | Combination delta below, prior art credited |
| Sustainability | Fixed fee and pot formulas; platform share; honest negative-sum math |

## Prior art and honest differentiation

Never claim a new genre. Prior art, read 2026-11-02 (sources/27 section 1): Eleusis and Zendo (hidden-rule induction games), Softmax Eleusis (sealed public-grammar LLM induction economy), WILT (hidden-rule induction benchmark), Freysa Act IV (TEE hidden prompt, paid attempts, pot), ETHGlobal TEE Trivia Tower (TEE-held answers, signed verdicts), same-event PROCTOR (sealed exams in OutLayer) and Bazaar of Liars (committed hidden parameters, server sees the secret).

**Our delta, a combination innovation [I]:** a pinned deterministic program derives the law without its creator learning it; paid experiments affect only capped issuance; a correct semantic guess releases a fixed pot and opens a browser-replayable proof. Remove creator-blind derivation and THE RULE collapses into existing riddle and prize games. That is why it is the kill gate.

## Risks and guarantees

| Risk | Owner | Handling |
| --- | --- | --- |
| Contract-initiated wasm-bound key path does not work on testnet | Lead | Phase 0 T1 to T3; kill on failure |
| OutLayer latency or cost breaks the play loop | Lead | T4; pending UI; 80/10/10 or shorter limits; refunds |
| Public grammar lets bots solve fast | Lead | Treated as the benchmark baseline, not hidden |
| TEE or keystore compromise | Disclosed | Trust wording; bounded amounts |
| Equivalence checker bug awards a false winner | Lead | P1.3 hard gate; differential tests |
| Human difficulty unknown | Lead | Measure in rehearsal; daily tier only |
| Legal status of paid prize games | Founder | Testnet only; no real value |
| Demo Mode confused with real rounds | Lead | Permanent label; separate instance |

## Sources and glossary

Sources (absolute paths, read-only): `C:/Users/HP Victus/Documents/personal-projects/hackathon/ideation/events/near-hackathon-2026/sources/28-rule-design.md` (design dossier, 2026-11-02), `.../27-rule-redteam.md` (red team, 2026-11-02), `.../29-wave5-synthesis.md`, `.../31-near-memecoin-list.md` (2026-11-04), `.../EVENT.md` (captured 2026-10-22), and the founder decision record of 2026-11-04 (D3 to D23). Live checks of 2026-11-04 are cited in the technical docs.

- **Round:** one sealed rule for one mode, at most 24 h. **Season:** 7 rounds per mode.
- **Play:** number + word + block time context + the entity's line. **Combination:** the full play key; identical keys always get identical verdicts.
- **Line:** an entity's last ACCEPT in this round (`prev`). **Entity:** a solo account or a team.
- **Commit seq:** the contract's global order number; the smallest correct one wins.
- **Freeze:** the moment the first correct guess is applied; plays and commits close.
- **Referee:** the OutLayer TDX program. **Rollover:** pot carried into the next round of the same mode.
