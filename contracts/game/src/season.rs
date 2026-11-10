//! Permissionless, bounded rebuilding of claim-independent season rankings.
use super::*;
use crate::settle::{Outcome, Payout};

#[derive(BorshSerialize, BorshDeserialize, Default)]
pub(crate) struct SeasonHeader {
    total: u32,
    indexed: u32,
    revision: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub(crate) struct SeasonEntry {
    rank: Option<RankKey>,
}

// Complements turn descending wins and shares into ascending tree keys.
#[derive(BorshSerialize, BorshDeserialize, Clone, Copy, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) struct RankKey {
    mode: u8,
    season: u32,
    wins: u32,
    shares: u32,
    block: u64,
    entity: Entity,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeasonStatus {
    ready: bool,
    total: u32,
    indexed: u32,
    revision: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeasonCursor {
    rounds_won: u32,
    shares: u32,
    earliest_winning_block: Option<u64>,
    entity_tag: u8,
    entity_id: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeasonRow {
    entity_tag: u8,
    entity_id: u32,
    rounds_won: u32,
    shares: u32,
    earned: U128,
    earliest_winning_block: Option<u64>,
    cursor: SeasonCursor,
}

impl Game {
    pub(crate) fn season_candidate(&mut self, mode: u8, round: u32, entity: Entity) {
        let season = round / 7;
        let key = (mode, season, entity);
        if self.season_entries.contains_key(&key) {
            return;
        }
        let header = self.season_headers.entry((mode, season)).or_default();
        let index = header.total;
        header.total = header.total.checked_add(1).expect("E11");
        // Appending cannot change cached Settled scores; terminal changes reset below.
        header.revision = header.revision.checked_add(1).expect("E11");
        self.season_candidates.insert((mode, season, index), entity);
        self.season_entries.insert(key, SeasonEntry { rank: None });
    }

    pub(crate) fn season_changed(&mut self, mode: u8, round: u32) {
        if let Some(header) = self.season_headers.get_mut(&(mode, round / 7)) {
            header.indexed = 0;
            header.revision = header.revision.checked_add(1).expect("E11");
        }
    }

    fn season_row(&self, mode: u8, season: u32, entity: Entity) -> SeasonRow {
        let (tag, id) = match entity {
            Entity::Solo(id) => (0, id),
            Entity::Team(id) => (1, id),
        };
        let mut row = SeasonRow {
            entity_tag: tag,
            entity_id: id,
            rounds_won: 0,
            shares: 0,
            earned: U128(0),
            earliest_winning_block: None,
            cursor: SeasonCursor {
                entity_tag: tag,
                entity_id: id,
                rounds_won: 0,
                shares: 0,
                earliest_winning_block: None,
            },
        };
        let start = u64::from(season) * 7;
        for n in start..start + 7 {
            let Ok(round) = u32::try_from(n) else { break };
            let Some(r) = self
                .rounds
                .get(&(mode, round))
                .filter(|r| r.phase == Phase::Settled)
            else {
                continue;
            };
            let Some(e) = self.entities.get(&(mode, round, entity)) else {
                continue;
            };
            let Some(Payout::Settled { winner, per_share }) = r.payout else {
                continue;
            };
            let won =
                matches!(&r.outcome, Some(Outcome::Solved { winner, .. }) if *winner == entity);
            let mut contribution = per_share * u128::from(e.shares);
            let mut award = if won { winner } else { 0 };
            if mode == 1 {
                let k = e.team_members.len() as u128;
                contribution = contribution / k * k;
                award = award / k * k;
            }
            row.shares += u32::from(e.shares);
            row.earned.0 += contribution + award;
            if won {
                row.rounds_won += 1;
                if let Some((_, commit)) = r
                    .best
                    .and_then(|(seq, id)| self.commits.get(&(mode, round, id)).map(|c| (seq, c)))
                {
                    row.earliest_winning_block = Some(
                        row.earliest_winning_block
                            .map_or(commit.block, |block| block.min(commit.block)),
                    );
                }
            }
        }
        row.cursor.rounds_won = row.rounds_won;
        row.cursor.shares = row.shares;
        row.cursor.earliest_winning_block = row.earliest_winning_block;
        row
    }

    fn season_status(&self, mode: u8, season: u32) -> SeasonStatus {
        let Some(h) = self.season_headers.get(&(mode, season)) else {
            return SeasonStatus {
                ready: true,
                total: 0,
                indexed: 0,
                revision: 0,
            };
        };
        SeasonStatus {
            ready: h.indexed == h.total,
            total: h.total,
            indexed: h.indexed,
            revision: h.revision,
        }
    }
}

#[near]
impl Game {
    pub fn get_season_status(&self, mode: Mode, season: u32) -> SeasonStatus {
        self.season_status(mode as u8, season)
    }

    pub fn index_season(&mut self, mode: Mode, season: u32, limit: u32) -> SeasonStatus {
        near_sdk::require!(limit > 0 && limit <= 20, "E11");
        let m = mode as u8;
        let status = self.season_status(m, season);
        let end = status.total.min(status.indexed.saturating_add(limit));
        for index in status.indexed..end {
            let entity = *self
                .season_candidates
                .get(&(m, season, index))
                .expect("season candidate missing");
            let row = self.season_row(m, season, entity);
            let rank = RankKey {
                mode: m,
                season,
                wins: u32::MAX - row.rounds_won,
                shares: u32::MAX - row.shares,
                block: row.earliest_winning_block.unwrap_or(u64::MAX),
                entity,
            };
            let entry = self
                .season_entries
                .get_mut(&(m, season, entity))
                .expect("season entry missing");
            if let Some(old) = entry.rank.replace(rank) {
                self.season_ranks.remove(&old);
            }
            self.season_ranks.insert(rank, ());
        }
        if let Some(header) = self.season_headers.get_mut(&(m, season)) {
            header.indexed = end;
        }
        self.season_status(m, season)
    }

    pub fn get_season(
        &self,
        mode: Mode,
        season: u32,
        from: Option<SeasonCursor>,
        limit: u32,
    ) -> Vec<SeasonRow> {
        use std::ops::Bound::{Excluded, Included};
        near_sdk::require!(limit <= 200, "E11");
        let m = mode as u8;
        near_sdk::require!(self.season_status(m, season).ready, "E50");
        let first = RankKey {
            mode: m,
            season,
            wins: 0,
            shares: 0,
            block: 0,
            entity: Entity::Solo(0),
        };
        let end = RankKey {
            mode: m,
            season,
            wins: u32::MAX,
            shares: u32::MAX,
            block: u64::MAX,
            entity: Entity::Team(u32::MAX),
        };
        let start = if let Some(cursor) = from {
            near_sdk::require!(cursor.rounds_won <= 7 && cursor.entity_tag == m, "E11");
            let entity = if m == 0 {
                Entity::Solo(cursor.entity_id)
            } else {
                Entity::Team(cursor.entity_id)
            };
            Excluded(RankKey {
                mode: m,
                season,
                wins: u32::MAX - cursor.rounds_won,
                shares: u32::MAX - cursor.shares,
                block: cursor.earliest_winning_block.unwrap_or(u64::MAX),
                entity,
            })
        } else {
            Included(first)
        };
        self.season_ranks
            .range((start, Included(end)))
            .take(limit as usize)
            .map(|(key, _)| self.season_row(m, season, key.entity))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_and_rank_storage_fit_action_allowance() {
        let mut ctx = near_sdk::test_utils::VMContextBuilder::new().build();
        near_sdk::testing_env!(ctx.clone());
        let mut candidates: LookupMap<(u8, u32, u32), Entity> = LookupMap::new(&b"sc"[..]);
        let mut entries: LookupMap<(u8, u32, Entity), SeasonEntry> = LookupMap::new(&b"se"[..]);
        let mut ranks: near_sdk::store::TreeMap<RankKey, ()> =
            near_sdk::store::TreeMap::new(&b"sr"[..]);
        for id in 0..128 {
            ctx.storage_usage = env::storage_usage();
            near_sdk::testing_env!(ctx.clone());
            let entity = Entity::Team(id);
            let rank = RankKey {
                mode: 1,
                season: u32::MAX,
                wins: u32::MAX,
                shares: u32::MAX,
                block: u64::MAX,
                entity,
            };
            let before = env::storage_usage();
            candidates.insert((1, u32::MAX, id), entity);
            entries.insert((1, u32::MAX, entity), SeasonEntry { rank: Some(rank) });
            ranks.insert(rank, ());
            candidates.flush();
            entries.flush();
            ranks.flush();
            let bytes = env::storage_usage() - before;
            assert!(bytes <= 400, "season candidate and rank used {bytes} bytes");
        }
        let baseline = env::storage_usage();
        for shares in 0..128 {
            ctx.storage_usage = env::storage_usage();
            near_sdk::testing_env!(ctx.clone());
            let entity = Entity::Team(64);
            let entry = entries.get_mut(&(1, u32::MAX, entity)).unwrap();
            ranks.remove(&entry.rank.unwrap());
            let rank = RankKey {
                mode: 1,
                season: u32::MAX,
                wins: u32::MAX,
                shares,
                block: u64::MAX,
                entity,
            };
            entry.rank = Some(rank);
            ranks.insert(rank, ());
            entries.flush();
            ranks.flush();
            assert!(
                env::storage_usage() <= baseline + 400,
                "rank replacements leaked storage"
            );
        }
    }
}
