//! Bounded teams, roster and vault custody.
use super::*;

#[derive(BorshSerialize, BorshDeserialize)]
pub(crate) struct Team {
    pub(crate) name: String,
    pub(crate) captain: AccountId,
    pub(crate) members: Vec<AccountId>,
    pub(crate) invites: Vec<AccountId>,
    pub(crate) deposits: Vec<(AccountId, u128)>,
    pub(crate) weight: u128,
    pub(crate) vault: u128,
    pub(crate) active_round: Option<u32>,
}

// floor(a*b/c), b <= c, without a 256-bit intermediate.
fn proportional(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0 && b <= c);
    let (mut q, mut r) = (0u128, 0u128);
    for bit in (0..128).rev() {
        q *= 2;
        if r >= c - r {
            r -= c - r;
            q += 1;
        } else {
            r += r;
        }
        if (b >> bit) & 1 != 0 {
            q += a / c;
            let x = a % c;
            if r >= c - x {
                r -= c - x;
                q += 1;
            } else {
                r += x;
            }
        }
    }
    q
}

#[near]
impl Game {
    pub fn create_team(&mut self, name: String) -> u32 {
        let actor = env::predecessor_account_id();
        near_sdk::require!(
            (3..=24).contains(&name.len())
                && name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            "E11"
        );
        near_sdk::require!(!self.team_membership.contains_key(&actor), "E33");
        let charge = self.params().storage_charge_team.0;
        let player = self
            .players
            .get_mut(&actor)
            .unwrap_or_else(|| env::panic_str("E20"));
        near_sdk::require!(player.credit >= charge, "E20");
        player.credit -= charge;
        self.total_credit -= charge;
        self.storage_reserve += charge;
        let id = self.next_team;
        self.next_team = id.checked_add(1).expect("E50");
        self.teams.insert(
            id,
            Team {
                name,
                captain: actor.clone(),
                members: vec![actor.clone()],
                invites: Vec::new(),
                deposits: Vec::new(),
                weight: 0,
                vault: 0,
                active_round: None,
            },
        );
        self.team_membership.insert(actor, id);
        id
    }

    pub fn invite(&mut self, account: AccountId) {
        let actor = env::predecessor_account_id();
        let id = self.team_id(&actor);
        self.require_team_unlocked(id);
        let max = usize::from(self.params().max_team_size);
        let t = self.teams.get_mut(&id).expect("team missing");
        near_sdk::require!(t.captain == actor, "E33");
        near_sdk::require!(
            !t.members.contains(&account) && !t.invites.contains(&account),
            "E11"
        );
        near_sdk::require!(t.members.len() + t.invites.len() < max, "E31");
        t.invites.push(account);
    }

    pub fn join_team(&mut self, team_id: u32) {
        let actor = env::predecessor_account_id();
        near_sdk::require!(self.players.contains_key(&actor), "E20");
        near_sdk::require!(!self.team_membership.contains_key(&actor), "E33");
        self.require_team_unlocked(team_id);
        let max = usize::from(self.params().max_team_size);
        let t = self
            .teams
            .get_mut(&team_id)
            .unwrap_or_else(|| env::panic_str("E32"));
        let pos = t
            .invites
            .iter()
            .position(|x| x == &actor)
            .unwrap_or_else(|| env::panic_str("E33"));
        near_sdk::require!(t.members.len() < max, "E31");
        t.invites.swap_remove(pos);
        t.members.push(actor.clone());
        self.team_membership.insert(actor, team_id);
    }
    pub fn leave_team(&mut self) {
        let actor = env::predecessor_account_id();
        let id = self.team_id(&actor);
        self.require_team_unlocked(id);
        self.remove_team_member(id, &actor);
    }

    pub fn remove_member(&mut self, account: AccountId) {
        let actor = env::predecessor_account_id();
        let id = self.team_id(&actor);
        self.require_team_unlocked(id);
        let t = self.teams.get(&id).expect("team missing");
        near_sdk::require!(t.captain == actor && actor != account, "E33");
        if t.invites.contains(&account) {
            self.teams
                .get_mut(&id)
                .expect("team missing")
                .invites
                .retain(|a| a != &account);
        } else {
            near_sdk::require!(t.members.contains(&account), "E33");
            self.remove_team_member(id, &account);
        }
    }

    #[payable]
    pub fn team_deposit(&mut self, team_id: u32) {
        let actor = env::predecessor_account_id();
        near_sdk::require!(self.team_id(&actor) == team_id, "E32");
        self.require_team_unlocked(team_id);
        let amount = env::attached_deposit().as_yoctonear();
        near_sdk::require!(amount > 0, "E11");
        let t = self.teams.get_mut(&team_id).expect("team missing");
        // Deposit weights equal contributed principal within an epoch. After losses,
        // adding nominal weights would subsidize existing positions with new capital.
        // Close those positions to credit before starting another deposit epoch.
        near_sdk::require!(t.vault == t.weight, "E30");
        if let Some((_, weight)) = t.deposits.iter_mut().find(|(a, _)| *a == actor) {
            *weight = weight.checked_add(amount).expect("E11");
        } else {
            near_sdk::require!(t.deposits.len() < 5, "E31");
            t.deposits.push((actor, amount));
        }
        t.weight = t.weight.checked_add(amount).expect("E11");
        t.vault = t.vault.checked_add(amount).expect("E11");
        self.total_vault = self.total_vault.checked_add(amount).expect("E11");
    }

    #[payable]
    pub fn team_withdraw(&mut self, team_id: u32) -> U128 {
        near_sdk::require!(env::attached_deposit().as_yoctonear() == 1, "E51");
        self.require_team_unlocked(team_id);
        let actor = env::predecessor_account_id();
        let amount = self.withdraw_team_weight(team_id, &actor);
        U128(amount)
    }

    pub fn get_team(&self, team_id: u32) -> Option<Value> {
        self.teams.get(&team_id).map(|t| json!({"team_id":team_id,"name":t.name,"captain":t.captain,"members":t.members,"invites":t.invites,"vault":U128(t.vault),"weight":U128(t.weight),"deposits":t.deposits.iter().map(|(a,w)| json!({"account":a,"weight":U128(*w)})).collect::<Vec<_>>(),"active_round":t.active_round}))
    }

    /// Return refundable principal and correct stakes to the team vault once terminal.
    pub fn settle_team(&mut self, team_id: u32) -> U128 {
        let round = self
            .teams
            .get(&team_id)
            .and_then(|t| t.active_round)
            .unwrap_or_else(|| env::panic_str("E56"));
        let key = (1, round, Entity::Team(team_id));
        let r = self
            .rounds
            .get(&(1, round))
            .unwrap_or_else(|| env::panic_str("E10"));
        near_sdk::require!(r.phase.is_terminal(), "E10");
        let e = self
            .entities
            .get(&key)
            .unwrap_or_else(|| env::panic_str("E56"));
        near_sdk::require!(!e.pending && !e.vault_claimed, "E21");
        let refund = if matches!(r.payout, Some(settle::Payout::Refund)) {
            e.pot_contribution
        } else {
            0
        };
        let stakes: u128 = e
            .correct_commits
            .iter()
            .filter_map(|i| self.commits.get(&(1, round, *i)))
            .map(|c| c.stake)
            .sum();
        self.entities
            .get_mut(&key)
            .expect("entity missing")
            .vault_claimed = true;
        self.total_claimable -= refund;
        self.total_stakes -= stakes;
        let amount = refund + stakes;
        let t = self.teams.get_mut(&team_id).expect("team missing");
        t.vault += amount;
        t.active_round = None;
        self.total_vault += amount;
        U128(amount)
    }
}

impl Game {
    pub(crate) fn team_id(&self, actor: &AccountId) -> u32 {
        self.team_membership
            .get(actor)
            .copied()
            .unwrap_or_else(|| env::panic_str("E32"))
    }
    pub(crate) fn resolve_entity(&self, mode: u8, actor: &AccountId) -> Option<Entity> {
        if mode == 0 {
            self.players.get(actor).map(|p| Entity::Solo(p.index))
        } else {
            Some(Entity::Team(self.team_id(actor)))
        }
    }
    fn require_team_unlocked(&self, id: u32) {
        let t = self.teams.get(&id).unwrap_or_else(|| env::panic_str("E32"));
        near_sdk::require!(t.active_round.is_none(), "E30");
    }
    fn withdraw_team_weight(&mut self, id: u32, actor: &AccountId) -> u128 {
        let t = self
            .teams
            .get_mut(&id)
            .unwrap_or_else(|| env::panic_str("E32"));
        let i = t
            .deposits
            .iter()
            .position(|(a, _)| a == actor)
            .unwrap_or_else(|| env::panic_str("E56"));
        let weight = t.deposits.swap_remove(i).1;
        let amount = proportional(t.vault, weight, t.weight);
        t.vault -= amount;
        t.weight -= weight;
        self.total_vault -= amount;
        self.credit_back(actor, amount);
        amount
    }
    fn remove_team_member(&mut self, id: u32, actor: &AccountId) {
        if self
            .teams
            .get(&id)
            .expect("team missing")
            .deposits
            .iter()
            .any(|(a, _)| a == actor)
        {
            self.withdraw_team_weight(id, actor);
        }
        let t = self.teams.get_mut(&id).expect("team missing");
        t.members.retain(|a| a != actor);
        if t.captain == *actor && !t.members.is_empty() {
            t.captain = t.members[0].clone();
        }
        self.team_membership.remove(actor);
        if t.members.is_empty() {
            self.teams.remove(&id);
        }
    }
    pub(crate) fn team_snapshot(&mut self, team_id: u32, round: u32) -> Vec<AccountId> {
        let t = self.teams.get_mut(&team_id).expect("team missing");
        near_sdk::require!(
            t.active_round.is_none() || t.active_round == Some(round),
            "E30"
        );
        t.active_round = Some(round);
        t.members.clone()
    }
    pub(crate) fn payer_balance(&self, entity: Entity, actor: &AccountId) -> u128 {
        match entity {
            Entity::Solo(_) => self.players.get(actor).map_or(0, |p| p.credit),
            Entity::Team(id) => self.teams.get(&id).map_or(0, |t| t.vault),
        }
    }
    pub(crate) fn debit_payer(&mut self, entity: Entity, actor: &AccountId, amount: u128) {
        match entity {
            Entity::Solo(_) => {
                self.players.get_mut(actor).expect("player missing").credit -= amount;
                self.total_credit -= amount;
            }
            Entity::Team(id) => {
                self.teams.get_mut(&id).expect("team missing").vault -= amount;
                self.total_vault -= amount;
            }
        }
    }
    pub(crate) fn refund_payer(&mut self, entity: Entity, actor: &AccountId, amount: u128) {
        match entity {
            Entity::Solo(_) => self.credit_back(actor, amount),
            Entity::Team(id) => {
                if let Some(t) = self.teams.get_mut(&id) {
                    t.vault += amount;
                    self.total_vault += amount;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::proportional;
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(proptest::test_runner::Config {
            rng_seed: proptest::test_runner::RngSeed::Fixed(0x5445_414d),
            failure_persistence: None,
            ..proptest::test_runner::Config::default()
        })]

        #[test]
        fn pro_rata_matches_direct_division_when_the_product_fits(
            amount in 0u128..1 << 63,
            weight in 0u128..1 << 63,
            extra in 0u128..1 << 63,
        ) {
            let total = weight + extra + 1;
            prop_assert_eq!(proportional(amount, weight, total), amount * weight / total);
        }

        #[test]
        fn full_width_complementary_weights_conserve_principal(
            amount in any::<u128>(),
            raw_weight in any::<u128>(),
            total in 1u128..=u128::MAX,
        ) {
            let weight = raw_weight % total;
            let left = proportional(amount, weight, total);
            let right = proportional(amount, total - weight, total);
            let allocated = left.checked_add(right).expect("allocation exceeded u128");
            prop_assert!(allocated <= amount);
            prop_assert!(amount - allocated <= 1);
            prop_assert_eq!(proportional(amount, total, total), amount);
            prop_assert_eq!(proportional(total, weight, total), weight);
        }
    }

    #[test]
    fn maximum_weights_preserve_exact_cancellation_and_rounding() {
        let max = u128::MAX;
        assert_eq!(proportional(max, max, max), max);
        assert_eq!(proportional(max, max - 1, max), max - 1);
        assert_eq!(proportional(max - 1, max / 2, max), max / 2 - 1);
        assert_eq!(proportional(max, 1, 2), max / 2);
        assert_eq!(proportional(max, 0, max), 0);
    }
}
