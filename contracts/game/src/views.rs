use super::*;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EntityView {
    attempts: u16,
    limit: u16,
    shares: u16,
    pending: bool,
    line: Option<LineView>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct LineView {
    number: u16,
    word_id: u8,
    timestamp: u64,
}

impl Game {
    pub(crate) fn get_round_inner(&self, mode: Mode, id: Option<u32>) -> Option<RoundView> {
        let m = mode as u8;
        let id = id.or(self.current[m as usize])?;
        self.rounds.get(&(m, id)).map(|r| RoundView {
            demo: self.demo,
            mode: m,
            round_id: id,
            slot_ns: r.slot_ns,
            sealing_started_ns: r.start_ns,
            begin_status: if r.phase == Phase::Sealing {
                if r.begin_pending { "pending" } else { "failed" }
            } else if r.commit.is_some() {
                "ok"
            } else {
                "failed"
            }
            .into(),
            investigation_end_ns: r.investigation_end_ns,
            freeze_ns: r.freeze_ns,
            pending_checks: r.pending_checks,
            opening_started_ns: None,
            open_status: "none".into(),
            outcome: None,
            phase: r.phase.name().into(),
            start_ns: r.start_ns,
            seed: Hex32(r.seed),
            commit: r.commit.map(Hex32),
            header: r.header.as_ref().and_then(|h| serde_json::from_str(h).ok()),
            pot: U128(r.pot),
            allowance_left: U128(r.allowance_left),
            reveal_deadline_ns: r.reveal_deadline_ns,
            log_len: r.log_len,
            rule: r.rule.as_ref().and_then(|s| serde_json::from_str(s).ok()),
            salt: r.salt.map(Hex32),
        })
    }
    pub(crate) fn get_active_rounds_inner(&self) -> Vec<RoundView> {
        self.active_rounds
            .iter()
            .filter_map(|&(mode, id)| {
                self.get_round(if mode == 0 { Mode::Solo } else { Mode::Team }, Some(id))
            })
            .filter(|round| {
                matches!(
                    round.phase.as_str(),
                    "Sealing" | "Investigation" | "Reveal" | "Opening"
                )
            })
            .collect()
    }

    pub(crate) fn get_next_slot_inner(&self, mode: Mode) -> Value {
        let i = mode as usize;
        let id = self.current[i].map_or(0, |id| id.saturating_add(1));
        let p = self.params();
        let slot = p
            .genesis_ns
            .saturating_add(u64::from(id).saturating_mul(p.round_period_ns))
            .saturating_add(p.mode_offset_ns[i]);
        json!({"round_id": id, "slot_ns": slot})
    }
    pub(crate) fn get_player_inner(&self, account: AccountId) -> Option<Value> {
        self.players
            .get(&account)
            .map(|p| json!({"index":p.index,"credit":U128(p.credit),"pending":p.pending}))
    }

    pub(crate) fn get_entity_inner(&self, mode: Mode, id: u32, account: AccountId) -> EntityView {
        let m = mode as u8;
        near_sdk::require!(m == 0, "E32");
        let limit = self.params().base_attempts[m as usize];
        let entity = self
            .players
            .get(&account)
            .map(|player| Entity::Solo(player.index));
        let state = entity.and_then(|entity| self.entities.get(&(m, id, entity)));
        match state {
            Some(e) => EntityView {
                attempts: e.attempts,
                limit,
                shares: e.shares,
                pending: e.pending,
                line: e.last_number.map(|number| LineView {
                    number,
                    word_id: e.last_word,
                    timestamp: e.last_time_ns,
                }),
            },
            None => EntityView {
                attempts: 0,
                limit,
                shares: 0,
                pending: false,
                line: None,
            },
        }
    }

    pub(crate) fn get_verdict_inner(
        &self,
        mode: Mode,
        id: u32,
        play: Play,
    ) -> Option<protocol::events::LogRow> {
        let m = mode as u8;
        let index = *self.seen.get(&(m, id, play.play_key().0))?;
        if index == u32::MAX {
            return None;
        }
        self.log
            .get(&(m, id, index))
            .and_then(|row| serde_json::from_str(row).ok())
    }

    pub(crate) fn get_word_list_inner(&self) -> Vec<String> {
        rule_core::words::WORDS
            .iter()
            .map(|word| (*word).to_owned())
            .collect()
    }
}
