use super::*;

impl Game {
    pub(crate) fn get_log_inner(
        &self,
        mode: Mode,
        id: u32,
        from_idx: u32,
        limit: u32,
    ) -> Vec<protocol::events::LogRow> {
        near_sdk::require!(limit <= 200, "E11");
        let m = mode as u8;
        let end = self
            .rounds
            .get(&(m, id))
            .map_or(0, |r| r.log_len)
            .min(from_idx.saturating_add(limit));
        (from_idx..end)
            .map(|i| {
                let row = self
                    .log
                    .get(&(m, id, i))
                    .unwrap_or_else(|| env::panic_str("invalid log state"));
                serde_json::from_str(row).unwrap_or_else(|_| env::panic_str("invalid log state"))
            })
            .collect()
    }
}
