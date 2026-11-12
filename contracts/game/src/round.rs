use super::*;

fn production_investigation_end(slot: u64, p: &Params) -> u64 {
    const DAY: u64 = 86_400_000_000_000;
    let duration = p
        .investigation_max_ns
        .min(p.round_period_ns.saturating_sub(p.reveal_window_ns))
        .min(DAY.saturating_sub(p.reveal_window_ns));
    slot.saturating_add(duration)
}

impl Game {
    /// Next unconsumed numbered slot; elapsed empty slots are never replayed.
    pub(crate) fn next_round_id(&self, mode: u8, p: &Params) -> u32 {
        let base = p.genesis_ns.saturating_add(p.mode_offset_ns[mode as usize]);
        let elapsed = env::block_timestamp().saturating_sub(base) / p.round_period_ns;
        let elapsed = u32::try_from(elapsed).unwrap_or(u32::MAX);
        let sequential = self.current[mode as usize].map_or(0, |id| {
            id.checked_add(1).unwrap_or_else(|| env::panic_str("E50"))
        });
        sequential.max(elapsed)
    }

    pub(crate) fn seed_pot_inner(&mut self, mode: Mode) {
        let i = mode as usize;
        self.carry[i] = self.carry[i]
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("E11");
    }

    pub(crate) fn start_round_inner(&mut self, mode: Mode, round_id: Option<u32>) -> u64 {
        let p = self.params();
        let m = mode as u8;
        let i = m as usize;
        let now = env::block_timestamp();
        let current = self.current[i];
        let sealing = current.is_some_and(|id| {
            self.rounds
                .get(&(m, id))
                .is_some_and(|r| r.phase == Phase::Sealing)
        });
        let id = if sealing {
            current.expect("missing current round")
        } else {
            self.next_round_id(m, &p)
        };
        near_sdk::require!(round_id.is_none_or(|target| target == id), "E50");
        if let Some(current_id) = current {
            let round = self
                .rounds
                .get(&(m, current_id))
                .expect("missing current round");
            if sealing {
                near_sdk::require!(
                    !round.begin_pending && now < round.start_ns.saturating_add(p.begin_timeout_ns),
                    "E50"
                );
            } else {
                near_sdk::require!(round.phase.is_past_reveal(), "E10");
            }
        }
        let slot = p
            .genesis_ns
            .checked_add(u64::from(id).checked_mul(p.round_period_ns).expect("E50"))
            .and_then(|v| v.checked_add(p.mode_offset_ns[i]))
            .expect("E50");
        near_sdk::require!(now >= slot, "E50");
        if !self.demo {
            near_sdk::require!(slot.checked_add(p.round_period_ns).is_some(), "E50");
            let cutoff = production_investigation_end(slot, &p);
            near_sdk::require!(now <= cutoff, "E50");
        }
        near_sdk::require!(self.compute_float >= p.outlayer_deposit.begin.0, "E22");
        near_sdk::require!(
            self.pending_referee_requests < MAX_PENDING_REFEREE_REQUESTS,
            "E23"
        );
        if self.current[i] != Some(id) {
            let active = self
                .active_rounds
                .iter()
                .filter(|key| {
                    self.rounds
                        .get(key)
                        .is_some_and(|round| !round.phase.is_terminal())
                })
                .count();
            near_sdk::require!(active < 10, "E23");
        }
        self.require_operator_storage(u64::from(self.current[i] != Some(id)));
        let seed = if self.current[i] == Some(id) {
            self.rounds.get(&(m, id)).expect("missing round").seed
        } else {
            let seed: [u8; 32] = env::random_seed().try_into().expect("invalid random seed");
            self.retained_rounds = self
                .retained_rounds
                .checked_add(1)
                .unwrap_or_else(|| env::panic_str("E50"));
            self.rounds.insert(
                (m, id),
                Round {
                    phase: Phase::Sealing,
                    start_ns: now,
                    slot_ns: slot,
                    investigation_end_ns: None,
                    seed,
                    commit: None,
                    header: None,
                    pot: self.carry[i],
                    allowance_left: p.round_allowance.0,
                    reveal_deadline_ns: 0,
                    begin_pending: false,
                    log_len: 0,
                    total_shares: 0,
                    rule: None,
                    salt: None,
                    commit_count: 0,
                    best: None,
                    freeze_ns: None,
                    pending_checks: 0,
                    base_pot: self.carry[i],
                    outcome: None,
                    open_status: settle::OpenStatus::None,
                    opening_started_ns: None,
                    sweep_cursor: 0,
                    payout: None,
                    team_residues: [0; 15],
                },
            );
            self.active_rounds
                .retain(|key| self.rounds.get(key).is_some_and(|r| !r.phase.is_terminal()));
            self.active_rounds.push((m, id));
            self.total_pots += self.carry[i];
            self.carry[i] = 0;
            self.current[i] = Some(id);
            seed
        };
        let request_id = self.next_request_id;
        self.next_request_id = request_id.checked_add(1).expect("E50");
        self.compute_float -= p.outlayer_deposit.begin.0;
        self.rounds
            .get_mut(&(m, id))
            .expect("missing round")
            .begin_pending = true;
        self.pending.insert(
            request_id,
            Request::Begin {
                mode: m,
                round: id,
                expires_at_ns: recovery::deadline(),
            },
        );
        self.pending_referee_requests += 1;
        let req = RefereeRequest::Begin {
            g: Grammar::G1,
            chain: p.chain_id.clone(),
            game: env::current_account_id().to_string(),
            mode,
            round: id,
            seed: Hex32(seed),
            commit: (),
        };
        self.execute(
            &req,
            request_id,
            p.outlayer_deposit.begin.0,
            p.resource_limits.begin,
            &p,
            "on_begin",
        );
        request_id
    }

    pub(crate) fn on_begin_inner(&mut self, request_id: u64) {
        let response = env::promise_result_checked(0, 1024)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        self.finish_begin(request_id, response);
    }

    pub(crate) fn finish_begin(&mut self, request_id: u64, response: Option<RefereeResponse>) {
        if !matches!(self.pending.get(&request_id), Some(Request::Begin { .. })) {
            return;
        }
        let Some(Request::Begin { mode, round, .. }) = self.pending.remove(&request_id) else {
            return;
        };
        self.pending_referee_requests = self.pending_referee_requests.saturating_sub(1);
        let params = self.params();
        let Some(r) = self.rounds.get_mut(&(mode, round)) else {
            return;
        };
        if r.phase != Phase::Sealing || !r.begin_pending {
            return;
        }
        r.begin_pending = false;
        let now = env::block_timestamp();
        let cutoff = production_investigation_end(r.slot_ns, &params);
        if now >= r.start_ns.saturating_add(params.begin_timeout_ns) || (!self.demo && now > cutoff)
        {
            self.refund_round(mode, round, Phase::Cancelled);
            return;
        }
        if let Some(RefereeResponse::Begin { commit, header }) = response
            && let Ok(header) = serde_json::to_string(&header)
        {
            r.commit = Some(commit.0);
            r.header = Some(header);
            let end = if self.demo {
                now.saturating_add(params.investigation_max_ns)
            } else {
                cutoff
            };
            r.investigation_end_ns = Some(end);
            if now >= end {
                r.phase = Phase::Reveal;
                r.freeze_ns = Some(end);
                r.reveal_deadline_ns = end.saturating_add(params.reveal_window_ns);
            } else {
                r.phase = Phase::Investigation;
            }
        }
        if r.phase == Phase::Sealing
            && env::block_timestamp() >= r.start_ns.saturating_add(params.begin_timeout_ns)
        {
            self.refund_round(mode, round, Phase::Cancelled);
        }
    }

    pub(crate) fn advance_inner(&mut self, mode: Mode, round_id: Option<u32>) {
        let p = self.params();
        let m = mode as u8;
        let id = self.current[m as usize].unwrap_or_else(|| env::panic_str("E10"));
        near_sdk::require!(round_id.is_none_or(|target| target == id), "E50");
        let r = self
            .rounds
            .get_mut(&(m, id))
            .unwrap_or_else(|| env::panic_str("E10"));
        near_sdk::require!(r.phase == Phase::Investigation, "E10");
        let now = env::block_timestamp();
        let end = r.investigation_end_ns.unwrap_or(u64::MAX);
        near_sdk::require!(now >= end, "E50");
        r.phase = Phase::Reveal;
        r.freeze_ns = Some(end);
        r.reveal_deadline_ns = end.saturating_add(p.reveal_window_ns);
    }
}
