//! Commit-reveal guesses: `commit_guess`, `reveal_guess`, the referee check callback and the freeze.
use super::*;
use protocol::{CommitPreimage, Entity as WireEntity, RuleHex};

#[derive(BorshSerialize, BorshDeserialize, Serialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub enum CommitStatus {
    Committed,
    Checking,
    Correct,
    Wrong,
    Refunded,
    /// Reserved for `finalize` (settle worker): a commit never revealed by the deadline.
    Unrevealed,
}

#[derive(BorshSerialize, BorshDeserialize, Clone)]
pub struct Commit {
    seq: u64,
    entity: Entity,
    actor: AccountId,
    hash: [u8; 32],
    stake: u128,
    block: u64,
    status: CommitStatus,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CommitAck {
    commit_seq: u32,
    seq: u64,
    stake: U128,
    block: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CommitView {
    commit_seq: u32,
    seq: u64,
    entity_tag: u8,
    entity_id: u32,
    actor: AccountId,
    hash: Hex32,
    stake: U128,
    block: u64,
    status: CommitStatus,
}

fn bps(amount: u128, bps: u16) -> u128 {
    amount / 10_000 * u128::from(bps) + amount % 10_000 * u128::from(bps) / 10_000
}

#[near]
impl Game {
    /// Lock a stake and register a hidden guess. The stake is `max(stake_min, pot * stake_bps)` now.
    pub fn commit_guess(&mut self, mode: Mode, hash: Hex32) -> CommitAck {
        self.commit_guess_inner(mode, hash.0)
    }

    /// Reveal a committed guess (canonical rule bytes as lowercase hex) and send it to the referee.
    pub fn reveal_guess(&mut self, mode: Mode, commit_seq: u32, guess: String, salt: Hex32) -> u64 {
        self.reveal_guess_inner(mode, commit_seq, guess, salt.0)
    }

    #[private]
    pub fn on_guess(&mut self, request_id: u64) {
        self.on_guess_inner(request_id);
    }

    pub fn get_commits(&self, mode: Mode, id: u32, from: u32, limit: u32) -> Vec<CommitView> {
        near_sdk::require!(limit <= 200, "E11");
        let m = mode as u8;
        let count = self.rounds.get(&(m, id)).map_or(0, |r| r.commit_count);
        (from..count.min(from.saturating_add(limit)))
            .filter_map(|i| {
                self.commits.get(&(m, id, i)).map(|c| {
                    let (entity_tag, entity_id) = match c.entity {
                        Entity::Solo(x) => (0, x),
                        Entity::Team(x) => (1, x),
                    };
                    CommitView {
                        commit_seq: i,
                        seq: c.seq,
                        entity_tag,
                        entity_id,
                        actor: c.actor.clone(),
                        hash: Hex32(c.hash),
                        stake: U128(c.stake),
                        block: c.block,
                        status: c.status,
                    }
                })
            })
            .collect()
    }
}

impl Game {
    pub(crate) fn commit_guess_inner(&mut self, mode: Mode, hash: [u8; 32]) -> CommitAck {
        let m = mode as u8;
        near_sdk::require!(m == 0, "E32");
        let id = self.current[0].unwrap_or_else(|| env::panic_str("E10"));
        let p = self.params();
        let pot = {
            let round = self
                .rounds
                .get(&(m, id))
                .unwrap_or_else(|| env::panic_str("E10"));
            near_sdk::require!(round.phase == Phase::Investigation, "E10");
            round.pot
        };
        let actor = env::predecessor_account_id();
        let player = self
            .players
            .get(&actor)
            .unwrap_or_else(|| env::panic_str("E20"));
        let (index, credit) = (player.index, player.credit);
        let entity = Entity::Solo(index);
        let entity_key = (m, id, entity);
        let open = self.entities.get(&entity_key).map_or(0, |e| e.open_commits);
        near_sdk::require!(open < 3, "E15");
        let stake = bps(pot, p.stake_bps[m as usize]).max(p.stake_min.0);
        // Each commit record occupies storage: it pays the same per-record charge as a play.
        let storage = p.storage_charge_per_play.0;
        let charge = stake
            .checked_add(storage)
            .unwrap_or_else(|| env::panic_str("E20"));
        near_sdk::require!(credit >= charge, "E20");

        let seq = self.next_seq;
        self.next_seq = seq.checked_add(1).unwrap_or_else(|| env::panic_str("E50"));
        let player = self.players.get_mut(&actor).expect("player vanished");
        player.credit -= charge;
        self.total_credit -= charge;
        self.total_stakes += stake;
        self.storage_reserve += storage;
        let round = self.rounds.get_mut(&(m, id)).expect("round vanished");
        let commit_seq = round.commit_count;
        round.commit_count = commit_seq
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("E50"));
        if !self.entities.contains_key(&entity_key) {
            self.entities.insert(entity_key, EntityRound::default());
        }
        self.entities
            .get_mut(&entity_key)
            .expect("entity vanished")
            .open_commits += 1;
        let block = env::block_height();
        self.commits.insert(
            (m, id, commit_seq),
            Commit {
                seq,
                entity,
                actor,
                hash,
                stake,
                block,
                status: CommitStatus::Committed,
            },
        );
        CommitAck {
            commit_seq,
            seq,
            stake: U128(stake),
            block,
        }
    }

    pub(crate) fn reveal_guess_inner(
        &mut self,
        mode: Mode,
        commit_seq: u32,
        guess: String,
        salt: [u8; 32],
    ) -> u64 {
        let m = mode as u8;
        near_sdk::require!(m == 0, "E32");
        let id = self.current[0].unwrap_or_else(|| env::panic_str("E10"));
        let p = self.params();
        let now = env::block_timestamp();
        let (round_seed, round_commit) = {
            let round = self
                .rounds
                .get(&(m, id))
                .unwrap_or_else(|| env::panic_str("E10"));
            match round.phase {
                Phase::Investigation => {}
                Phase::Reveal => near_sdk::require!(now < round.reveal_deadline_ns, "E16"),
                _ => env::panic_str("E10"),
            }
            (
                round.seed,
                round.commit.unwrap_or_else(|| env::panic_str("E10")),
            )
        };
        let commit = self
            .commits
            .get(&(m, id, commit_seq))
            .unwrap_or_else(|| env::panic_str("E11"))
            .clone();
        near_sdk::require!(env::predecessor_account_id() == commit.actor, "E17");
        near_sdk::require!(commit.status == CommitStatus::Committed, "E10");
        near_sdk::require!(
            env::block_height() >= commit.block.saturating_add(p.min_reveal_delay_blocks),
            "E18"
        );
        let rule: RuleHex =
            serde_json::from_value(Value::String(guess)).unwrap_or_else(|_| env::panic_str("E11"));
        let wire_entity = match commit.entity {
            Entity::Solo(x) => WireEntity::Solo(x),
            Entity::Team(x) => WireEntity::Team(x),
        };
        let game_account = env::current_account_id();
        let preimage = protocol::commit_preimage(&CommitPreimage {
            chain: &p.chain_id,
            game: game_account.as_str(),
            mode,
            round: id,
            actor: commit.actor.as_str(),
            entity: wire_entity,
            guess: &rule.0,
            salt: &salt,
        });
        near_sdk::require!(env::sha256_array(&preimage) == commit.hash, "E19");
        near_sdk::require!(self.compute_float >= p.outlayer_deposit.guess.0, "E22");

        let request_id = self.next_request_id;
        self.next_request_id = request_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("E50"));
        self.compute_float -= p.outlayer_deposit.guess.0;
        self.commits
            .get_mut(&(m, id, commit_seq))
            .expect("commit vanished")
            .status = CommitStatus::Checking;
        self.rounds
            .get_mut(&(m, id))
            .expect("round vanished")
            .pending_checks += 1;
        self.pending.insert(
            request_id,
            Request::Guess {
                mode: m,
                round: id,
                commit_seq,
            },
        );
        let request = RefereeRequest::Guess {
            g: Grammar::G1,
            chain: p.chain_id.clone(),
            game: game_account.to_string(),
            mode,
            round: id,
            seed: Hex32(round_seed),
            commit: Hex32(round_commit),
            guess: rule,
        };
        self.execute(
            &request,
            request_id,
            p.outlayer_deposit.guess.0,
            p.resource_limits.guess,
            &p,
            "on_guess",
        );
        request_id
    }

    pub(crate) fn on_guess_inner(&mut self, request_id: u64) {
        let Some(Request::Guess {
            mode,
            round,
            commit_seq,
        }) = self.pending.remove(&request_id)
        else {
            return;
        };
        let key = (mode, round, commit_seq);
        let Some(mut commit) = self.commits.get(&key).cloned() else {
            return;
        };
        if commit.status != CommitStatus::Checking {
            return;
        }
        let p = self.params();
        let now = env::block_timestamp();
        let verdict: Option<bool> = env::promise_result_checked(0, 1024)
            .ok()
            .and_then(|b| serde_json::from_slice::<RefereeResponse>(&b).ok())
            .and_then(|r| match r {
                RefereeResponse::Guess { correct } => Some(correct),
                _ => None,
            });
        let live = self
            .rounds
            .get(&(mode, round))
            .is_some_and(|r| matches!(r.phase, Phase::Investigation | Phase::Reveal));
        if let Some(r) = self.rounds.get_mut(&(mode, round)) {
            r.pending_checks = r.pending_checks.saturating_sub(1);
        }
        let result = match verdict.filter(|_| live) {
            Some(true) => {
                commit.status = CommitStatus::Correct;
                if let Some(r) = self.rounds.get_mut(&(mode, round)) {
                    if r.best.is_none_or(|(seq, _)| commit.seq < seq) {
                        r.best = Some((commit.seq, commit_seq));
                    }
                    if r.freeze_ns.is_none() {
                        r.freeze_ns = Some(now);
                        if r.phase == Phase::Investigation {
                            r.phase = Phase::Reveal;
                            r.reveal_deadline_ns = now.saturating_add(p.reveal_window_ns);
                        }
                    }
                }
                "correct"
            }
            Some(false) => {
                commit.status = CommitStatus::Wrong;
                let returned = bps(commit.stake, p.wrong_return_bps);
                let to_pot = commit.stake - returned;
                self.total_stakes -= commit.stake;
                self.credit_back(&commit.actor, returned);
                if let Some(r) = self.rounds.get_mut(&(mode, round)) {
                    r.pot += to_pot;
                    self.total_pots += to_pot;
                }
                self.close_commit(mode, round, commit.entity);
                "wrong"
            }
            None => {
                // System failure (D7): the full stake returns and the commit cannot be revealed again.
                commit.status = CommitStatus::Refunded;
                self.total_stakes -= commit.stake;
                self.credit_back(&commit.actor, commit.stake);
                self.close_commit(mode, round, commit.entity);
                "refunded"
            }
        };
        self.commits.insert(key, commit);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"the-rule","version":"1.0.0","event":"guess_checked","data":[{"mode":mode,"round_id":round,"commit_seq":commit_seq,"result":result}]})
        ));
    }

    fn credit_back(&mut self, actor: &AccountId, amount: u128) {
        if let Some(player) = self.players.get_mut(actor) {
            player.credit += amount;
            self.total_credit += amount;
        }
    }

    fn close_commit(&mut self, mode: u8, round: u32, entity: Entity) {
        if let Some(e) = self.entities.get_mut(&(mode, round, entity)) {
            e.open_commits = e.open_commits.saturating_sub(1);
        }
    }
}
