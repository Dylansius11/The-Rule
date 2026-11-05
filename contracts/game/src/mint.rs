//! RULE minting: one-time token registration, the per-ACCEPT mint and its failure handling.
use super::*;

/// `floor(a * b / c)` for `b <= c < 2^127`, without a 256-bit intermediate.
/// Double-and-add over the bits of `b`, keeping `a * prefix = q * c + r` with `r < c`.
pub(crate) fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0 && c < 1 << 127 && b <= c, "mul_div domain");
    let (mut q, mut r) = (0u128, 0u128);
    for bit in (0..128).rev() {
        q <<= 1;
        r <<= 1;
        if r >= c {
            r -= c;
            q += 1;
        }
        if (b >> bit) & 1 == 1 {
            q += a / c;
            r += a % c;
            if r >= c {
                r -= c;
                q += 1;
            }
        }
    }
    q
}

fn bucket_bps(bucket: &str) -> u16 {
    match bucket {
        "rare" => 10_000,
        "mid" => 5_000,
        "common" => 2_500,
        _ => 0,
    }
}

/// Mint for one ACCEPT: `mint_base * allowance_left / round_allowance * bucket_bps / 10_000`.
/// The allowance shrinks with every mint, so a round can never mint more than `round_allowance`.
pub(crate) fn accept_mint(p: &Params, header: Option<&str>, allowance_left: u128) -> u128 {
    let bucket = header
        .and_then(|h| serde_json::from_str::<Value>(h).ok())
        .and_then(|h| h["bucket"].as_str().map(bucket_bps))
        .unwrap_or(0);
    let scaled = mul_div(
        p.mint_base.0,
        allowance_left.min(p.round_allowance.0),
        p.round_allowance.0,
    );
    bps(scaled, bucket).min(allowance_left)
}

/// Gas given to `on_mint`; it only restores the allowance on failure.
const MINT_CALLBACK_GAS: Gas = Gas::from_tgas(10);

/// Whether the running callback still has the gas to schedule a mint and its callback with a
/// margin. A callback must never run out of gas (its request would stay pending forever), so a
/// verdict that cannot afford the mint simply mints nothing and keeps the allowance.
pub(crate) fn mint_gas_available(p: &Params) -> bool {
    let left = env::prepaid_gas()
        .as_gas()
        .saturating_sub(env::used_gas().as_gas());
    left >= p
        .gas_mint
        .saturating_add(MINT_CALLBACK_GAS.as_gas())
        .saturating_add(Gas::from_tgas(5).as_gas())
}

fn event(name: &str, data: &Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"the-rule","version":"1.0.0","event":name,"data":[data]})
    ));
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct TokenStorageBalance {
    total: U128,
    available: U128,
}

#[near]
impl Game {
    /// Check the caller's existing token registration. The player pays token storage directly.
    /// Until registered, an ACCEPT mints nothing and uses no allowance.
    pub fn register_token(&mut self) -> u64 {
        self.register_token_inner()
    }

    #[private]
    pub fn on_register(&mut self, request_id: u64) {
        self.on_register_inner(request_id);
    }

    #[private]
    pub fn on_mint(&mut self, request_id: u64) {
        self.on_mint_inner(request_id);
    }

    pub fn get_token_state(&self, account: AccountId) -> String {
        match self.players.get(&account).map(|player| player.token) {
            Some(TokenState::Registered) => "registered",
            Some(TokenState::Pending) => "pending",
            _ => "none",
        }
        .into()
    }
}

impl Game {
    fn register_token_inner(&mut self) -> u64 {
        let actor = env::predecessor_account_id();
        let p = self.params();
        let token: AccountId = p.token.parse().expect("validated at init");
        let player = self
            .players
            .get_mut(&actor)
            .unwrap_or_else(|| env::panic_str("E20"));
        near_sdk::require!(player.token != TokenState::Pending, "E57");
        player.token = TokenState::Pending;
        let id = self.next_request_id;
        self.next_request_id = id.checked_add(1).unwrap_or_else(|| env::panic_str("E50"));
        self.pending.insert(
            id,
            Request::Register {
                actor: actor.clone(),
                expires_at_ns: recovery::deadline(),
            },
        );
        Promise::new(token)
            .function_call(
                "storage_balance_of",
                serde_json::to_vec(&json!({"account_id":actor})).expect("arguments serialization"),
                NearToken::from_yoctonear(0),
                Gas::from_gas(p.gas_mint),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_register",
                serde_json::to_vec(&json!({"request_id":id})).expect("callback serialization"),
                NearToken::from_yoctonear(0),
                Gas::from_gas(p.gas_callback),
            ))
            .detach();
        id
    }

    fn on_register_inner(&mut self, request_id: u64) {
        let registered = env::promise_result_checked(0, 4096)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<TokenStorageBalance>(&bytes).ok())
            .is_some_and(|balance| balance.available.0 <= balance.total.0);
        self.finish_register(request_id, registered);
    }

    pub(crate) fn finish_register(&mut self, request_id: u64, registered: bool) {
        if !matches!(
            self.pending.get(&request_id),
            Some(Request::Register { .. })
        ) {
            return;
        }
        let Some(Request::Register { actor, .. }) = self.pending.remove(&request_id) else {
            return;
        };
        if let Some(player) = self.players.get_mut(&actor) {
            player.token = if registered {
                TokenState::Registered
            } else {
                TokenState::None
            };
        }
    }

    /// Ask the token to mint `amount` to `actor` for the ACCEPT logged at `log_idx`.
    pub(crate) fn send_mint(
        &mut self,
        mode: u8,
        round: u32,
        log_idx: u32,
        actor: &AccountId,
        amount: u128,
    ) {
        let p = self.params();
        let id = self.next_request_id;
        self.next_request_id = id.checked_add(1).unwrap_or_else(|| env::panic_str("E50"));
        self.pending.insert(
            id,
            Request::Mint {
                mode,
                round,
                log_idx,
                amount,
            },
        );
        let token: AccountId = p.token.parse().expect("validated at init");
        Promise::new(token)
            .function_call(
                "mint",
                serde_json::to_vec(&json!({"account_id":actor,"amount":U128(amount)}))
                    .expect("arguments serialization"),
                NearToken::from_yoctonear(0),
                Gas::from_gas(p.gas_mint),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_mint",
                serde_json::to_vec(&json!({"request_id":id})).expect("callback serialization"),
                NearToken::from_yoctonear(0),
                MINT_CALLBACK_GAS,
            ))
            .detach();
    }

    /// A failed mint restores the round allowance and zeroes the row; the verdict stands.
    fn on_mint_inner(&mut self, request_id: u64) {
        if !matches!(self.pending.get(&request_id), Some(Request::Mint { .. })) {
            return;
        }
        let Some(Request::Mint {
            mode,
            round,
            log_idx,
            amount,
        }) = self.pending.remove(&request_id)
        else {
            return;
        };
        if env::promise_result_checked(0, 0).is_ok() {
            return;
        }
        if let Some(r) = self.rounds.get_mut(&(mode, round)) {
            r.allowance_left += amount;
        }
        if let Some(row) = self.log.get(&(mode, round, log_idx))
            && let Ok(mut value) = serde_json::from_str::<Value>(row)
        {
            value["minted"] = json!(U128(0));
            self.log.insert((mode, round, log_idx), value.to_string());
        }
        event(
            "mint_failed",
            &json!({"mode":mode,"round_id":round,"log_idx":log_idx,"amount":U128(amount)}),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::mul_div;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn agrees_with_direct_division_when_the_product_fits(
            a in 0u128..1 << 63,
            b in 0u128..1 << 63,
            extra in 0u128..1 << 63,
        ) {
            let c = b + extra + 1;
            prop_assert_eq!(mul_div(a, b, c), a * b / c);
        }
    }

    #[test]
    fn full_scale_amounts_do_not_overflow() {
        let base = 100_000_000_000_000_000_000u128;
        let round = 500_000_000_000_000_000_000_000u128;
        assert_eq!(mul_div(base, round, round), base);
        assert_eq!(mul_div(base, round / 2, round), base / 2);
        assert_eq!(mul_div(base, round / 4 * 3, round), base / 4 * 3);
        assert_eq!(mul_div(base, 1, round), 0);
        assert_eq!(mul_div(u128::MAX, 1 << 126, 1 << 126), u128::MAX);
        assert_eq!(mul_div(u128::MAX, 1, 2), u128::MAX / 2);
    }
}
