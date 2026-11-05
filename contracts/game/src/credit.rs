use super::*;

impl Game {
    pub(crate) fn deposit_credit_inner(&mut self) {
        let actor = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        let charge = if self.players.contains_key(&actor) {
            0
        } else {
            self.params().storage_charge_account.0
        };
        near_sdk::require!(amount >= charge, "E20");
        if charge != 0 || !self.players.contains_key(&actor) {
            let index = self.next_player;
            self.next_player = index.checked_add(1).expect("E11");
            self.players.insert(
                actor.clone(),
                Player {
                    index,
                    credit: 0,
                    pending: false,
                    checking_guesses: 0,
                    token: TokenState::None,
                },
            );
            self.storage_reserve = self.storage_reserve.checked_add(charge).expect("E11");
        }
        let player = self.players.get_mut(&actor).expect("missing player");
        player.credit = player.credit.checked_add(amount - charge).expect("E11");
        self.total_credit = self.total_credit.checked_add(amount - charge).expect("E11");
    }

    pub(crate) fn withdraw_credit_inner(&mut self, amount: U128) {
        near_sdk::require!(env::attached_deposit().as_yoctonear() == 1, "E51");
        let actor = env::predecessor_account_id();
        let player = self
            .players
            .get_mut(&actor)
            .unwrap_or_else(|| env::panic_str("E20"));
        near_sdk::require!(!player.pending && player.checking_guesses == 0, "E21");
        near_sdk::require!(player.credit >= amount.0, "E20");
        player.credit -= amount.0;
        player.pending = true;
        self.total_credit -= amount.0;
        let id = self.next_request_id;
        self.next_request_id = id.checked_add(1).expect("E50");
        self.pending.insert(
            id,
            Request::Withdraw {
                actor: actor.clone(),
                amount: amount.0,
            },
        );
        Promise::new(actor)
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_withdraw",
                serde_json::to_vec(&json!({"request_id":id})).expect("callback serialization"),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            ))
            .detach();
    }

    pub(crate) fn on_withdraw_inner(&mut self, request_id: u64) {
        let Some(Request::Withdraw { actor, amount }) = self.pending.remove(&request_id) else {
            return;
        };
        if let Some(player) = self.players.get_mut(&actor) {
            player.pending = false;
            if env::promise_result_checked(0, 0).is_err() {
                player.credit += amount;
                self.total_credit += amount;
            }
        }
    }
}
