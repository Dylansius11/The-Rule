//! Separate unallocated operator collateral from pots, credit, vaults and compute.
use super::*;

// Actual-Borsh bounds are asserted in storage_proof; the extra space covers
// record overhead, active-index growth and one platform request per round.
const ROOT_BYTES: u64 = 8192;
const ROUND_BYTES: u64 = 1024;
const REFUNDABLE_REQUEST_BYTES: u64 = 1024;

impl Game {
    pub(crate) fn operator_storage_required(&self, additional_rounds: u64) -> u128 {
        let retained_rounds: u64 = self
            .current
            .iter()
            .flatten()
            .map(|id| u64::from(*id) + 1)
            .sum();
        let bytes = u128::from(self.base_storage_bytes)
            + u128::from(ROOT_BYTES)
            + u128::from(retained_rounds + additional_rounds) * u128::from(ROUND_BYTES)
            + u128::from(MAX_PENDING_REFEREE_REQUESTS) * u128::from(REFUNDABLE_REQUEST_BYTES);
        bytes * env::storage_byte_cost().as_yoctonear()
    }

    pub(crate) fn operator_storage_available(&self) -> u128 {
        let reserved = [
            self.total_credit,
            self.total_vault,
            self.total_pots,
            self.carry[0],
            self.carry[1],
            self.total_stakes,
            self.total_claimable,
            self.compute_float,
            self.platform_accrued,
            self.pending_credit,
            // A failed transfer's refund may arrive before the callback restores
            // its ledger liability. Keep it reserved until that callback, even
            // while escrowed or already paid: conservative admission, not recovery.
            self.pending_native_payments,
            self.storage_reserve,
        ]
        .into_iter()
        .try_fold(0u128, u128::checked_add);
        reserved.map_or(0, |amount| {
            env::account_balance().as_yoctonear().saturating_sub(amount)
        })
    }

    pub(crate) fn require_operator_storage(&self, additional_rounds: u64) {
        near_sdk::require!(
            self.operator_storage_available() >= self.operator_storage_required(additional_rounds),
            "E24"
        );
    }
}
