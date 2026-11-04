use super::*;

impl Game {
    pub(crate) fn play_inner(&mut self, mode: Mode, number: u16, word: String) -> PlayAck {
        let m = mode as u8;
        let id = self.current[m as usize].unwrap_or_else(|| env::panic_str("E10"));
        let round = self
            .rounds
            .get(&(m, id))
            .unwrap_or_else(|| env::panic_str("E10"));
        near_sdk::require!(round.phase == Phase::Investigation, "E10");
        near_sdk::require!(m == 0, "E32");
        let word_id = rule_core::words::normalize(&word).unwrap_or_else(|| env::panic_str("E11"));
        near_sdk::require!(number <= 999, "E11");
        let actor = env::predecessor_account_id();
        let now = env::block_timestamp();
        let entity = self
            .players
            .get(&actor)
            .map(|player| Entity::Solo(player.index));
        let previous = entity
            .and_then(|entity| self.entities.get(&(m, id, entity)))
            .and_then(|e| {
                e.last_number.map(|n| Previous {
                    number: n,
                    word_id: e.last_word,
                    gap_bucket: if now.saturating_sub(e.last_time_ns) < 60_000_000_000 {
                        0
                    } else if now.saturating_sub(e.last_time_ns) < 3_600_000_000_000 {
                        1
                    } else {
                        2
                    },
                })
            });
        let play = Play::new(
            number,
            word_id,
            ((now / 60_000_000_000) % 10) as u8,
            previous,
        )
        .unwrap_or_else(|_| env::panic_str("E11"));
        let key = play.play_key().0;
        if let Some(idx) = self.seen.get(&(m, id, key)).copied() {
            near_sdk::require!(idx != u32::MAX, "E12");
            let row: Value =
                serde_json::from_str(self.log.get(&(m, id, idx)).expect("missing log"))
                    .expect("invalid log");
            return PlayAck::Known {
                verdict: row["verdict"].as_bool().expect("invalid verdict"),
                log_idx: idx,
            };
        }
        let p = self.params();
        if let Some(entity) = entity.and_then(|entity| self.entities.get(&(m, id, entity))) {
            near_sdk::require!(!entity.pending, "E13");
            near_sdk::require!(entity.attempts < p.base_attempts[m as usize], "E14");
        }
        let charge = p
            .play_fee
            .0
            .checked_add(p.storage_charge_per_play.0)
            .unwrap_or_else(|| env::panic_str("E20"));
        let player = self
            .players
            .get(&actor)
            .unwrap_or_else(|| env::panic_str("E20"));
        near_sdk::require!(!player.pending, "E13");
        near_sdk::require!(player.credit >= charge, "E20");
        let entity_id = Entity::Solo(player.index);
        let entity_key = (m, id, entity_id);
        near_sdk::require!(self.compute_float >= p.outlayer_deposit.verdict.0, "E22");
        let seed = round.seed;
        let commit = round.commit.expect("missing commitment");
        let request_id = self.next_request_id;
        self.next_request_id = request_id.checked_add(1).expect("E50");
        let seq = self.next_seq;
        self.next_seq = seq.checked_add(1).expect("E50");
        let player = self.players.get_mut(&actor).expect("E20");
        player.credit -= charge;
        player.pending = true;
        self.total_credit -= charge;
        self.pending_credit += charge;
        self.compute_float -= p.outlayer_deposit.verdict.0;
        if !self.entities.contains_key(&entity_key) {
            self.entities.insert(entity_key, EntityRound::default());
        }
        let entity = self.entities.get_mut(&entity_key).expect("missing entity");
        entity.pending = true;
        entity.attempts += 1;
        self.seen.insert((m, id, key), u32::MAX);
        self.pending.insert(
            request_id,
            Request::Verdict {
                mode: m,
                round: id,
                entity: entity_id,
                actor,
                play: serde_json::to_string(&play).expect("play serialization"),
                key,
                seq,
                timestamp: now,
            },
        );
        let req = RefereeRequest::Verdict {
            g: Grammar::G1,
            chain: p.chain_id.clone(),
            game: env::current_account_id().to_string(),
            mode,
            round: id,
            seed: Hex32(seed),
            commit: Hex32(commit),
            play,
        };
        self.execute(
            &req,
            request_id,
            p.outlayer_deposit.verdict.0,
            p.resource_limits.verdict,
            &p,
            "on_verdict",
        );
        PlayAck::Pending { request_id, seq }
    }

    pub(crate) fn on_verdict_inner(&mut self, request_id: u64) {
        let Some(Request::Verdict {
            mode,
            round,
            entity,
            actor,
            play,
            key,
            seq,
            timestamp,
        }) = self.pending.remove(&request_id)
        else {
            return;
        };
        let p = self.params();
        let amount = p.play_fee.0 + p.storage_charge_per_play.0;
        let parsed: Option<bool> = env::promise_result_checked(0, 1024)
            .ok()
            .and_then(|b| serde_json::from_slice::<RefereeResponse>(&b).ok())
            .and_then(|r| match r {
                RefereeResponse::Verdict { v } => Some(v == protocol::Verdict::Yes),
                _ => None,
            });
        let parsed_play = serde_json::from_str::<Play>(&play).ok();
        let valid = parsed_play.is_some()
            && self
                .rounds
                .get(&(mode, round))
                .is_some_and(|r| r.phase == Phase::Investigation);
        let entity_key = (mode, round, entity);
        if let Some(player) = self.players.get_mut(&actor) {
            player.pending = false;
        }
        if let Some(entity) = self.entities.get_mut(&entity_key) {
            entity.pending = false;
        }
        self.pending_credit -= amount;
        let Some(verdict) = parsed.filter(|_| valid) else {
            if let Some(player) = self.players.get_mut(&actor) {
                player.credit += amount;
                self.total_credit += amount;
            }
            let remove_entity = if let Some(entity) = self.entities.get_mut(&entity_key) {
                entity.attempts = entity.attempts.saturating_sub(1);
                entity.attempts == 0 && entity.shares == 0 && entity.last_number.is_none()
            } else {
                false
            };
            if remove_entity {
                self.entities.remove(&entity_key);
            }
            self.seen.remove(&(mode, round, key));
            let event = protocol::events::PlayRefunded {
                request_id,
                reason: if valid {
                    "invalid_response"
                } else {
                    "round_closed"
                }
                .into(),
            };
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({"standard":"the-rule","version":"1.0.0","event":"play_refunded","data":[event]})
            ));
            return;
        };
        let compute = p.play_fee.0 / 10_000 * u128::from(p.fee_split_bps[1])
            + p.play_fee.0 % 10_000 * u128::from(p.fee_split_bps[1]) / 10_000;
        let platform = p.play_fee.0 / 10_000 * u128::from(p.fee_split_bps[2])
            + p.play_fee.0 % 10_000 * u128::from(p.fee_split_bps[2]) / 10_000;
        let pot = p.play_fee.0 - compute - platform;
        self.compute_float += compute;
        self.platform_accrued += platform;
        self.storage_reserve += p.storage_charge_per_play.0;
        self.total_pots += pot;
        if let Some(r) = self.rounds.get_mut(&(mode, round)) {
            r.pot += pot;
            let idx = r.log_len;
            r.log_len += 1;
            let actor_idx = self.players.get(&actor).map(|p| p.index).unwrap_or(0);
            let (entity_tag, entity_id) = match entity {
                Entity::Solo(id) => (0, id),
                Entity::Team(id) => (1, id),
            };
            let Some(play_value) = parsed_play else {
                return;
            };
            let row = protocol::events::LogRow {
                log_idx: idx,
                seq,
                play_key: key.to_string(),
                entity_tag,
                entity_id,
                actor: actor_idx,
                account: actor.to_string(),
                play: play_value,
                verdict,
                minted: protocol::params::Amount(0),
            };
            let Ok(row_json) = serde_json::to_string(&row) else {
                return;
            };
            self.log.insert((mode, round, idx), row_json);
            let mode_value = if mode == 0 { Mode::Solo } else { Mode::Team };
            let event = protocol::events::PlaySettled {
                mode: mode_value,
                round_id: round,
                row,
            };
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({"standard":"the-rule","version":"1.0.0","event":"play_settled","data":[event]})
            ));
            self.seen.insert((mode, round, key), idx);
            if let Some(entity) = self.entities.get_mut(&entity_key) {
                entity.pot_contribution += pot;
                if entity.shares < p.share_cap[mode as usize] {
                    entity.shares += 1;
                    r.total_shares += 1;
                }
                if verdict && let Ok(play) = serde_json::from_str::<Play>(&play) {
                    entity.last_number = Some(play.number());
                    entity.last_word = play.word_id();
                    entity.last_time_ns = timestamp;
                }
            }
        }
    }
}
