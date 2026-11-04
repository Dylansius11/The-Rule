use super::*;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Ledger {
    balance: U128,
    credit: U128,
    vault: U128,
    round_pots: U128,
    carry: U128,
    open_stakes: U128,
    claimable: U128,
    compute_float: U128,
    platform_accrued: U128,
    storage_reserve: U128,
    locked_storage: U128,
    pending_credit: U128,
}

impl Game {
    pub(crate) fn get_ledger_inner(&self) -> Ledger {
        Ledger {
            balance: U128(env::account_balance().as_yoctonear()),
            credit: U128(self.total_credit),
            vault: U128(0),
            round_pots: U128(self.total_pots),
            carry: U128(self.carry[0] + self.carry[1]),
            open_stakes: U128(self.total_stakes),
            claimable: U128(0),
            compute_float: U128(self.compute_float),
            platform_accrued: U128(self.platform_accrued),
            storage_reserve: U128(self.storage_reserve),
            locked_storage: U128(
                u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear(),
            ),
            pending_credit: U128(self.pending_credit),
        }
    }
}
