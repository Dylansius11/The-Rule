//! Permissionless recovery for referee requests and read-only token registration checks.
use super::*;

/// Ten minutes from request initiation, independent of round begin/open deadlines.
/// A slow successful callback may still win the receipt-order race until recovery is applied.
const REQUEST_TIMEOUT_NS: u64 = 600_000_000_000;

pub(crate) fn deadline() -> u64 {
    env::block_timestamp().saturating_add(REQUEST_TIMEOUT_NS)
}

#[near]
impl Game {
    /// Apply the failure path for a referee or read-only registration request after ten minutes.
    /// Returns false for an absent/completed request or a request with external token/payment effects.
    /// A recoverable request before its deadline rejects E50 without changing state.
    pub fn expire_request(&mut self, request_id: u64) -> bool {
        let (expires_at_ns, kind) = match self.pending.get(&request_id) {
            Some(Request::Begin { expires_at_ns, .. }) => (*expires_at_ns, 0),
            Some(Request::Verdict { expires_at_ns, .. }) => (*expires_at_ns, 1),
            Some(Request::Guess { expires_at_ns, .. }) => (*expires_at_ns, 2),
            Some(Request::Open { expires_at_ns, .. }) => (*expires_at_ns, 3),
            Some(Request::Register { expires_at_ns, .. }) => (*expires_at_ns, 4),
            _ => return false,
        };
        near_sdk::require!(env::block_timestamp() >= expires_at_ns, "E50");
        // These are exactly the same failure handlers as real callbacks. Each consumes the
        // original request first, fencing late responses and repeated recovery calls.
        match kind {
            0 => self.finish_begin(request_id, None),
            1 => self.finish_verdict(request_id, None),
            2 => self.finish_guess(request_id, None),
            3 => self.finish_open(request_id, None),
            _ => self.finish_register(request_id, false),
        }
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard":"the-rule","version":"1.0.0","event":"request_expired","data":[{"request_id":request_id}]})
        ));
        true
    }
}
