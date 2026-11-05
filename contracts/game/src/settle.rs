//! Closing a round: `finalize`, the `open` callback, cancel and void refunds, `claim`, platform share.
use super::*;
use crate::guess::{Commit, CommitStatus};

/// Unrevealed commits swept per `finalize` call, so a round with many commits never exceeds the gas cap.
const SWEEP_BATCH: u32 = 20;

#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpenStatus {
    None,
    Pending,
    Failed,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, Eq, PartialEq)]
pub enum Outcome {
    Solved { winner: Entity, account: AccountId },
    Unsolved,
}

impl Outcome {
    pub(crate) fn to_json(&self) -> Value {
        match self {
            Self::Solved { winner, account } => {
                let (tag, id) = match winner {
                    Entity::Solo(id) => (0, *id),
                    Entity::Team(id) => (1, *id),
                };
                json!({"kind":"Solved","entity_tag":tag,"entity_id":id,"account":account})
            }
            Self::Unsolved => json!({"kind":"Unsolved"}),
        }
    }
}

/// Amounts fixed when the round ends. `Refund` returns each entity its own pot contribution.
#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum Payout {
    Settled { winner: u128, per_share: u128 },
    Refund,
}

pub(crate) fn open_status_name(round: &Round) -> &'static str {
    match (round.phase, round.open_status) {
        (Phase::Settled | Phase::Void, _) => "ok",
        (_, OpenStatus::None) => "none",
        (_, OpenStatus::Pending) => "pending",
        (_, OpenStatus::Failed) => "failed",
    }
}

fn mode_of(m: u8) -> Mode {
    if m == 0 { Mode::Solo } else { Mode::Team }
}

fn event(name: &str, data: &Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"the-rule","version":"1.0.0","event":name,"data":[data]})
    ));
}

#[near]
impl Game {
    /// Close Reveal: sweep unrevealed commits, then ask the referee to open the rule.
    /// Returns the `open` request id once the round is Opening; `None` means call again
    /// (more commits to sweep).
    pub fn finalize(&mut self, mode: Mode) -> Option<u64> {
        self.finalize_inner(mode)
    }

    #[private]
    pub fn on_open(&mut self, request_id: u64) {
        self.on_open_inner(request_id);
    }

    /// Ask again after a failed `open`, before `open_timeout_ns`.
    pub fn retry_open(&mut self, mode: Mode, round_id: u32) -> u64 {
        self.retry_open_inner(mode, round_id)
    }

    /// Cancel a round whose `begin` never succeeded or whose `open` kept failing past its timeout.
    pub fn cancel(&mut self, mode: Mode, round_id: u32) {
        self.cancel_inner(mode, round_id);
    }

    /// Credit the caller's payout (or refund) and returned stakes of a finished round. Once only.
    pub fn claim(&mut self, mode: Mode, round_id: u32) -> U128 {
        U128(self.claim_inner(mode, round_id))
    }

    pub fn get_claimable(&self, mode: Mode, round_id: u32, account: AccountId) -> U128 {
        let m = mode as u8;
        let amount = self
            .players
            .get(&account)
            .filter(|_| m == 0)
            .map_or(0, |player| {
                let (payout, stakes) = self.claim_parts(m, round_id, Entity::Solo(player.index));
                payout + stakes
            });
        U128(amount)
    }

    /// Anyone may send the accrued platform share to the configured platform account.
    pub fn claim_platform(&mut self) -> u64 {
        self.claim_platform_inner()
    }

    #[private]
    pub fn on_platform(&mut self, request_id: u64) {
        self.on_platform_inner(request_id);
    }
}

impl Game {
    /// A wrong or unrevealed stake: part returns to the staker's credit, the rest feeds the pot.
    pub(crate) fn apply_wrong_stake(
        &mut self,
        mode: u8,
        round: u32,
        commit: &Commit,
        return_bps: u16,
    ) {
        let returned = bps(commit.stake, return_bps);
        let to_pot = commit.stake - returned;
        self.total_stakes -= commit.stake;
        self.credit_back(&commit.actor, returned);
        if let Some(r) = self.rounds.get_mut(&(mode, round)) {
            r.pot += to_pot;
            self.total_pots += to_pot;
        }
        if let Some(e) = self.entities.get_mut(&(mode, round, commit.entity)) {
            e.pot_contribution += to_pot;
        }
        self.close_commit(mode, round, commit.entity);
    }

    fn finalize_inner(&mut self, mode: Mode) -> Option<u64> {
        let m = mode as u8;
        let id = self.current[m as usize].unwrap_or_else(|| env::panic_str("E10"));
        let p = self.params();
        let now = env::block_timestamp();
        let (count, cursor) = {
            let r = self
                .rounds
                .get(&(m, id))
                .unwrap_or_else(|| env::panic_str("E10"));
            near_sdk::require!(r.phase == Phase::Reveal, "E10");
            near_sdk::require!(now >= r.reveal_deadline_ns && r.pending_checks == 0, "E50");
            (r.commit_count, r.sweep_cursor)
        };
        near_sdk::require!(self.compute_float >= p.outlayer_deposit.open.0, "E22");
        near_sdk::require!(
            self.pending_referee_requests < MAX_PENDING_REFEREE_REQUESTS,
            "E23"
        );
        let end = count.min(cursor.saturating_add(SWEEP_BATCH));
        for i in cursor..end {
            let key = (m, id, i);
            let Some(mut commit) = self.commits.get(&key).cloned() else {
                continue;
            };
            if commit.status == CommitStatus::Committed {
                commit.status = CommitStatus::Unrevealed;
                self.apply_wrong_stake(m, id, &commit, p.wrong_return_bps);
                self.commits.insert(key, commit);
            }
        }
        self.rounds
            .get_mut(&(m, id))
            .expect("round vanished")
            .sweep_cursor = end;
        if end < count {
            return None;
        }
        let best = self.rounds.get(&(m, id)).expect("round vanished").best;
        let outcome = match best.and_then(|(_, cs)| self.commits.get(&(m, id, cs))) {
            Some(c) => Outcome::Solved {
                winner: c.entity,
                account: c.actor.clone(),
            },
            None => Outcome::Unsolved,
        };
        let r = self.rounds.get_mut(&(m, id)).expect("round vanished");
        r.phase = Phase::Opening;
        r.opening_started_ns = Some(now);
        r.outcome = Some(outcome);
        Some(self.send_open(m, id, &p))
    }

    /// Reserve the referee deposit, mark the open pending and send the request.
    fn send_open(&mut self, m: u8, id: u32, p: &Params) -> u64 {
        near_sdk::require!(self.compute_float >= p.outlayer_deposit.open.0, "E22");
        near_sdk::require!(
            self.pending_referee_requests < MAX_PENDING_REFEREE_REQUESTS,
            "E23"
        );
        let (seed, commit) = {
            let r = self.rounds.get(&(m, id)).expect("round vanished");
            (r.seed, r.commit.expect("opening round has a commitment"))
        };
        let request_id = self.next_request_id;
        self.next_request_id = request_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("E50"));
        self.compute_float -= p.outlayer_deposit.open.0;
        self.pending.insert(
            request_id,
            Request::Open {
                mode: m,
                round: id,
                expires_at_ns: recovery::deadline(),
            },
        );
        self.pending_referee_requests += 1;
        self.rounds
            .get_mut(&(m, id))
            .expect("round vanished")
            .open_status = OpenStatus::Pending;
        let request = RefereeRequest::Open {
            g: Grammar::G1,
            chain: p.chain_id.clone(),
            game: env::current_account_id().to_string(),
            mode: mode_of(m),
            round: id,
            seed: Hex32(seed),
            commit: Hex32(commit),
        };
        self.execute(
            &request,
            request_id,
            p.outlayer_deposit.open.0,
            p.resource_limits.open,
            p,
            "on_open",
        );
        request_id
    }

    fn retry_open_inner(&mut self, mode: Mode, round_id: u32) -> u64 {
        let m = mode as u8;
        let p = self.params();
        let r = self
            .rounds
            .get(&(m, round_id))
            .unwrap_or_else(|| env::panic_str("E10"));
        near_sdk::require!(
            r.phase == Phase::Opening && r.open_status == OpenStatus::Failed,
            "E10"
        );
        near_sdk::require!(
            env::block_timestamp()
                < r.opening_started_ns
                    .unwrap_or(0)
                    .saturating_add(p.open_timeout_ns),
            "E50"
        );
        self.send_open(m, round_id, &p)
    }

    fn on_open_inner(&mut self, request_id: u64) {
        let response = env::promise_result_checked(0, 4096)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        self.finish_open(request_id, response);
    }

    pub(crate) fn finish_open(&mut self, request_id: u64, response: Option<RefereeResponse>) {
        if !matches!(self.pending.get(&request_id), Some(Request::Open { .. })) {
            return;
        }
        let Some(Request::Open { mode, round, .. }) = self.pending.remove(&request_id) else {
            return;
        };
        self.pending_referee_requests = self.pending_referee_requests.saturating_sub(1);
        let Some(r) = self.rounds.get_mut(&(mode, round)) else {
            return;
        };
        if r.phase != Phase::Opening || r.open_status != OpenStatus::Pending {
            return;
        }
        let commitment = r.commit.expect("opening round has a commitment");
        let opened = response.and_then(|response| match response {
            RefereeResponse::Open { rule, salt } => Some((rule, salt)),
            _ => None,
        });
        let Some((rule, salt)) = opened else {
            r.open_status = OpenStatus::Failed;
            event("open_failed", &json!({"mode":mode,"round_id":round}));
            return;
        };
        let mut preimage = rule_core::canonical::encode(&rule);
        preimage.extend_from_slice(&salt.0);
        let got = env::sha256_array(&preimage);
        if got == commitment {
            let rule_json = serde_json::to_string(&rule).expect("rule serialization");
            self.settle_round(mode, round, rule_json, salt.0);
        } else {
            event(
                "round_void",
                &json!({"mode":mode,"round_id":round,"expected":Hex32(commitment),"got":Hex32(got)}),
            );
            self.refund_round(mode, round, Phase::Void);
        }
    }

    /// The opened rule matches the commitment: split the pot (SMART-CONTRACT 'Payout formulas').
    fn settle_round(&mut self, mode: u8, round: u32, rule: String, salt: [u8; 32]) {
        let p = self.params();
        let r = self.rounds.get_mut(&(mode, round)).expect("round vanished");
        let pot = r.pot;
        let solved = matches!(r.outcome, Some(Outcome::Solved { .. }));
        let (winner, contributors, rollover, platform) = if solved {
            let s = p.solved_split_bps;
            (
                bps(pot, s[0]),
                bps(pot, s[1]),
                bps(pot, s[2]),
                bps(pot, s[3]),
            )
        } else {
            let s = p.unsolved_split_bps;
            (0, bps(pot, s[0]), bps(pot, s[1]), bps(pot, s[2]))
        };
        let shares = u128::from(r.total_shares);
        // Nobody earned a share: the contributors' part rolls over, never to the platform (D6).
        let (contributors, rollover) = if shares == 0 {
            (0, rollover + contributors)
        } else {
            (contributors, rollover)
        };
        let per_share = contributors.checked_div(shares).unwrap_or(0);
        let paid_shares = per_share * shares;
        let dust = pot - winner - platform - rollover - paid_shares;
        let rollover = rollover + dust;
        r.phase = Phase::Settled;
        r.rule = Some(rule);
        r.salt = Some(salt);
        r.payout = Some(Payout::Settled { winner, per_share });
        self.total_pots -= pot;
        self.carry[mode as usize] += rollover;
        self.platform_accrued += platform;
        self.total_claimable += winner + paid_shares;
        event(
            "round_settled",
            &json!({"mode":mode,"round_id":round,"pot":U128(pot),"winner_amount":U128(winner),"per_share":U128(per_share),"rollover":U128(rollover),"platform":U128(platform),"solved":solved}),
        );
    }

    /// Cancelled or Void: carry and seed go back to `carry`; every entity may claim its own
    /// pot contribution (fees and wrong-stake halves) plus returned stakes.
    pub(crate) fn refund_round(&mut self, mode: u8, round: u32, phase: Phase) {
        let r = self.rounds.get_mut(&(mode, round)).expect("round vanished");
        let (pot, base) = (r.pot, r.base_pot);
        r.phase = phase;
        r.payout = Some(Payout::Refund);
        self.total_pots -= pot;
        self.carry[mode as usize] += base;
        self.total_claimable += pot - base;
        if phase == Phase::Cancelled {
            event("round_cancelled", &json!({"mode":mode,"round_id":round}));
        }
    }

    fn cancel_inner(&mut self, mode: Mode, round_id: u32) {
        let m = mode as u8;
        let p = self.params();
        let now = env::block_timestamp();
        let r = self
            .rounds
            .get(&(m, round_id))
            .unwrap_or_else(|| env::panic_str("E10"));
        match r.phase {
            Phase::Sealing => near_sdk::require!(
                !r.begin_pending && now >= r.start_ns.saturating_add(p.begin_timeout_ns),
                "E50"
            ),
            Phase::Opening => near_sdk::require!(
                r.open_status == OpenStatus::Failed
                    && now
                        >= r.opening_started_ns
                            .unwrap_or(0)
                            .saturating_add(p.open_timeout_ns),
                "E50"
            ),
            _ => env::panic_str("E10"),
        }
        self.refund_round(m, round_id, Phase::Cancelled);
    }

    /// `(payout, stakes)` the entity would receive from `claim` now. Zero when nothing is owed.
    pub(crate) fn claim_parts(&self, m: u8, round: u32, entity: Entity) -> (u128, u128) {
        let Some(r) = self
            .rounds
            .get(&(m, round))
            .filter(|r| r.phase.is_terminal())
        else {
            return (0, 0);
        };
        let Some(e) = self
            .entities
            .get(&(m, round, entity))
            .filter(|e| !e.claimed)
        else {
            return (0, 0);
        };
        let payout = match r.payout {
            Some(Payout::Settled { winner, per_share }) => {
                let won =
                    matches!(&r.outcome, Some(Outcome::Solved { winner: w, .. }) if *w == entity);
                per_share * u128::from(e.shares) + if won { winner } else { 0 }
            }
            Some(Payout::Refund) => e.pot_contribution,
            None => 0,
        };
        let stakes = e
            .correct_commits
            .iter()
            .filter_map(|i| self.commits.get(&(m, round, *i)))
            .map(|c| c.stake)
            .sum();
        (payout, stakes)
    }

    fn claim_inner(&mut self, mode: Mode, round_id: u32) -> u128 {
        let m = mode as u8;
        near_sdk::require!(m == 0, "E32");
        let actor = env::predecessor_account_id();
        let index = self
            .players
            .get(&actor)
            .unwrap_or_else(|| env::panic_str("E56"))
            .index;
        let entity = Entity::Solo(index);
        near_sdk::require!(
            self.rounds
                .get(&(m, round_id))
                .is_some_and(|r| r.phase.is_terminal()),
            "E10"
        );
        let (payout, stakes) = self.claim_parts(m, round_id, entity);
        let total = payout + stakes;
        near_sdk::require!(total > 0, "E56");
        self.entities
            .get_mut(&(m, round_id, entity))
            .expect("entity vanished")
            .claimed = true;
        self.total_claimable -= payout;
        self.total_stakes -= stakes;
        self.credit_back(&actor, total);
        event(
            "claimed",
            &json!({"mode":m,"round_id":round_id,"account":actor,"payout":U128(payout),"stakes":U128(stakes)}),
        );
        total
    }

    fn claim_platform_inner(&mut self) -> u64 {
        let amount = self.platform_accrued;
        near_sdk::require!(amount > 0, "E56");
        let platform: AccountId = self.params().platform.parse().expect("validated at init");
        self.platform_accrued = 0;
        let id = self.next_request_id;
        self.next_request_id = id.checked_add(1).unwrap_or_else(|| env::panic_str("E50"));
        self.pending.insert(id, Request::Platform { amount });
        Promise::new(platform)
            .transfer(NearToken::from_yoctonear(amount))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_platform",
                serde_json::to_vec(&json!({"request_id":id})).expect("callback serialization"),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            ))
            .detach();
        id
    }

    fn on_platform_inner(&mut self, request_id: u64) {
        if !matches!(
            self.pending.get(&request_id),
            Some(Request::Platform { .. })
        ) {
            return;
        }
        let Some(Request::Platform { amount }) = self.pending.remove(&request_id) else {
            return;
        };
        if env::promise_result_checked(0, 0).is_err() {
            self.platform_accrued += amount;
        }
    }
}
