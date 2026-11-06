use super::*;

impl Game {
    pub(crate) fn seed_pot_inner(&mut self, mode: Mode) {
        let i = mode as usize;
        self.carry[i] = self.carry[i]
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("E11");
    }

    pub(crate) fn start_round_inner(&mut self, mode: Mode) -> u64 {
        let p = self.params();
        let m = mode as u8;
        let i = m as usize;
        let now = env::block_timestamp();
        let id = match self.current[i] {
            None => 0,
            Some(id) => {
                let round = self.rounds.get(&(m, id)).expect("missing current round");
                if round.phase == Phase::Sealing {
                    near_sdk::require!(
                        !round.begin_pending
                            && now < round.start_ns.saturating_add(p.begin_timeout_ns),
                        "E50"
                    );
                    id
                } else {
                    near_sdk::require!(round.phase.is_past_reveal(), "E10");
                    id.checked_add(1).expect("E50")
                }
            }
        };
        let slot = p
            .genesis_ns
            .checked_add(u64::from(id).checked_mul(p.round_period_ns).expect("E50"))
            .and_then(|v| v.checked_add(p.mode_offset_ns[i]))
            .expect("E50");
        near_sdk::require!(now >= slot, "E50");
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
        if let Some(RefereeResponse::Begin { commit, header }) = response
            && let Ok(header) = serde_json::to_string(&header)
        {
            r.commit = Some(commit.0);
            r.header = Some(header);
            r.investigation_end_ns =
                Some(env::block_timestamp().saturating_add(params.investigation_max_ns));
            r.phase = Phase::Investigation;
        }
        if r.phase == Phase::Sealing
            && env::block_timestamp() >= r.start_ns.saturating_add(params.begin_timeout_ns)
        {
            self.refund_round(mode, round, Phase::Cancelled);
        }
    }

    pub(crate) fn advance_inner(&mut self, mode: Mode) {
        let p = self.params();
        let m = mode as u8;
        let id = self.current[m as usize].unwrap_or_else(|| env::panic_str("E10"));
        let r = self
            .rounds
            .get_mut(&(m, id))
            .unwrap_or_else(|| env::panic_str("E10"));
        near_sdk::require!(r.phase == Phase::Investigation, "E10");
        let now = env::block_timestamp();
        near_sdk::require!(now >= r.investigation_end_ns.unwrap_or(u64::MAX), "E50");
        r.phase = Phase::Reveal;
        r.freeze_ns = Some(now);
        r.reveal_deadline_ns = now.saturating_add(p.reveal_window_ns);
    }
}
