//! RULE locks: lock tokens for a future round to raise its attempt limit, and always get them back.
use super::*;

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct LockMsg {
    lock: LockTarget,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct LockTarget {
    mode: Mode,
    round_id: u32,
}

fn event(name: &str, data: &Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"the-rule","version":"1.0.0","event":name,"data":[data]})
    ));
}

#[near]
impl Game {
    /// NEP-141 receiver. Only the RULE token may call it. A valid message
    /// `{"lock":{"mode":0,"round_id":r}}` for a round that has not reached Investigation locks the
    /// tokens. New lock entries pay the per-record storage charge from game credit; top-ups are
    /// free. Rejected transfers return the full amount to the sender without charging credit.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        self.ft_on_transfer_inner(sender_id, amount, &msg)
    }

    /// Return locked RULE after the round is over. Attach exactly 1 yoctoNEAR.
    #[payable]
    pub fn unlock(&mut self, mode: Mode, round_id: u32) {
        self.unlock_inner(mode, round_id);
    }

    #[private]
    pub fn on_unlock(&mut self, request_id: u64) {
        self.on_unlock_inner(request_id);
    }

    pub fn get_lock(&self, mode: Mode, round_id: u32, account: AccountId) -> U128 {
        U128(
            self.locks
                .get(&(mode as u8, round_id, account))
                .copied()
                .unwrap_or(0),
        )
    }
}

impl Game {
    /// Attempts an entity may use in a round: the base plus the highest lock tier reached, capped.
    pub(crate) fn attempt_limit(
        &self,
        p: &Params,
        mode: u8,
        round: u32,
        account: &AccountId,
    ) -> u16 {
        let locked = self
            .locks
            .get(&(mode, round, account.clone()))
            .copied()
            .unwrap_or(0);
        let bonus = p
            .lock_tiers
            .iter()
            .filter(|tier| locked >= tier.amount.0)
            .map(|tier| tier.extra_attempts)
            .max()
            .unwrap_or(0);
        p.base_attempts[mode as usize]
            .saturating_add(bonus)
            .min(p.attempt_cap[mode as usize])
    }

    /// The only round of `mode` that may still receive locks: the one being sealed or the next one.
    fn lockable_round(&self, mode: u8) -> u32 {
        match self.current[mode as usize] {
            None => 0,
            Some(id) => {
                let sealing = self
                    .rounds
                    .get(&(mode, id))
                    .is_some_and(|r| r.phase == Phase::Sealing);
                if sealing { id } else { id.saturating_add(1) }
            }
        }
    }

    fn ft_on_transfer_inner(&mut self, sender: AccountId, amount: U128, msg: &str) -> U128 {
        let p = self.params();
        near_sdk::require!(env::predecessor_account_id().as_str() == p.token, "E40");
        let reject = |reason: &str| {
            event(
                "lock_rejected",
                &json!({"account":sender,"amount":amount,"reason":reason}),
            );
            amount
        };
        let Ok(LockMsg { lock }) = serde_json::from_str::<LockMsg>(msg) else {
            return reject("E11");
        };
        let m = lock.mode as u8;
        if m != 0 {
            return reject("E32");
        }
        if amount.0 == 0 || lock.round_id != self.lockable_round(m) {
            return reject("E41");
        }
        let key = (m, lock.round_id, sender.clone());
        let existing = self.locks.get(&key).copied();
        let Some(total) = existing.unwrap_or(0).checked_add(amount.0) else {
            return reject("E11");
        };
        if existing.is_none() {
            let storage = p.storage_charge_per_play.0;
            let Some(player) = self.players.get(&sender) else {
                return reject("E20");
            };
            if player.credit < storage {
                return reject("E20");
            }
            let Some(reserve) = self.storage_reserve.checked_add(storage) else {
                return reject("E11");
            };
            self.players.get_mut(&sender).expect("player exists").credit -= storage;
            self.total_credit -= storage;
            self.storage_reserve = reserve;
        }
        self.locks.insert(key, total);
        event(
            "lock_placed",
            &json!({"mode":m,"round_id":lock.round_id,"account":sender,"amount":amount,"total":U128(total)}),
        );
        U128(0)
    }

    fn unlock_inner(&mut self, mode: Mode, round_id: u32) {
        near_sdk::require!(env::attached_deposit().as_yoctonear() == 1, "E51");
        let m = mode as u8;
        let p = self.params();
        let actor = env::predecessor_account_id();
        let key = (m, round_id, actor.clone());
        let amount = self
            .locks
            .get(&key)
            .copied()
            .unwrap_or_else(|| env::panic_str("E56"));
        let over = match self.rounds.get(&(m, round_id)) {
            Some(r) => r.phase.is_terminal(),
            // A round that never started releases its locks one full period after its slot.
            None => {
                let slot = p
                    .genesis_ns
                    .saturating_add(u64::from(round_id).saturating_mul(p.round_period_ns))
                    .saturating_add(p.mode_offset_ns[m as usize]);
                env::block_timestamp() >= slot.saturating_add(p.round_period_ns)
            }
        };
        near_sdk::require!(over, "E10");
        self.locks.remove(&key);
        let id = self.next_request_id;
        self.next_request_id = id.checked_add(1).unwrap_or_else(|| env::panic_str("E50"));
        self.pending.insert(
            id,
            Request::Unlock {
                mode: m,
                round: round_id,
                actor: actor.clone(),
                amount,
            },
        );
        let token: AccountId = p.token.parse().expect("validated at init");
        Promise::new(token)
            .function_call(
                "ft_transfer",
                serde_json::to_vec(&json!({"receiver_id":actor,"amount":U128(amount)}))
                    .expect("arguments serialization"),
                NearToken::from_yoctonear(1),
                Gas::from_gas(p.gas_mint),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_unlock",
                serde_json::to_vec(&json!({"request_id":id})).expect("callback serialization"),
                NearToken::from_yoctonear(0),
                Gas::from_gas(p.gas_callback),
            ))
            .detach();
    }

    /// A failed transfer puts the lock back: locked RULE is never forfeited.
    fn on_unlock_inner(&mut self, request_id: u64) {
        if !matches!(self.pending.get(&request_id), Some(Request::Unlock { .. })) {
            return;
        }
        let Some(Request::Unlock {
            mode,
            round,
            actor,
            amount,
        }) = self.pending.remove(&request_id)
        else {
            return;
        };
        if env::promise_result_checked(0, 0).is_ok() {
            event(
                "lock_released",
                &json!({"mode":mode,"round_id":round,"account":actor,"amount":U128(amount)}),
            );
            return;
        }
        let key = (mode, round, actor);
        let restored = self.locks.get(&key).copied().unwrap_or(0) + amount;
        self.locks.insert(key, restored);
    }
}
