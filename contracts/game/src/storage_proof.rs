//! Actual-Borsh storage bounds, not a second wire-format implementation.
//! Maxima may be independent rather than co-reachable. Runtime storage_usage is
//! authoritative; these bounds include the sandbox-observed 40-byte trie overhead.
use super::*;

fn record<K: BorshSerialize, V: BorshSerialize>(prefix: &[u8], key: &K, value: &V) -> usize {
    prefix.len() + borsh::to_vec(key).unwrap().len() + borsh::to_vec(value).unwrap().len() + 40
}

#[test]
fn maximum_retained_records_and_callback_headroom() {
    let actor: AccountId = "a".repeat(64).parse().unwrap();
    let player = Player {
        index: u32::MAX,
        credit: u128::MAX,
        pending: true,
        checking_guesses: u32::MAX,
        token: TokenState::Registered,
    };
    let player_bytes = record(b"a", &actor, &player);
    let withdrawal = record(
        b"p",
        &u64::MAX,
        &Request::Withdraw {
            actor: actor.clone(),
            amount: u128::MAX,
        },
    );
    let registration = record(
        b"p",
        &u64::MAX,
        &Request::Register {
            actor: actor.clone(),
            expires_at_ns: u64::MAX,
        },
    );
    let entity = EntityRound {
        attempts: u16::MAX,
        shares: u16::MAX,
        pot_contribution: u128::MAX,
        pending: true,
        last_number: Some(999),
        last_word: 127,
        last_time_ns: u64::MAX,
        open_commits: 3,
        claimed: true,
        correct_commits: vec![u32::MAX; 3],
        team_members: vec![actor.clone(); 5],
        team_claimed: 0b11111,
        vault_claimed: true,
        team_committed: true,
    };
    let entity_bytes = record(b"e", &(1u8, u32::MAX, Entity::Team(u32::MAX)), &entity);
    let play = Play::new(
        999,
        127,
        9,
        Some(Previous {
            number: 999,
            word_id: 127,
            gap_bucket: 2,
        }),
    )
    .unwrap();
    let row = protocol::events::LogRow {
        log_idx: u32::MAX,
        seq: u64::MAX,
        play_key: u64::MAX.to_string(),
        entity_tag: 1,
        entity_id: u32::MAX,
        actor: u32::MAX,
        account: actor.to_string(),
        play,
        verdict: false,
        minted: protocol::params::Amount(u128::MAX),
    };
    let row_json = serde_json::to_string(&row).unwrap();
    let log_bytes = record(b"l", &(1u8, u32::MAX, u32::MAX), &row_json);
    let seen_bytes = record(b"s", &(1u8, u32::MAX, u64::MAX), &u32::MAX);
    let verdict = record(
        b"p",
        &u64::MAX,
        &Request::Verdict {
            mode: 1,
            round: u32::MAX,
            entity: Entity::Team(u32::MAX),
            actor: actor.clone(),
            play: serde_json::to_string(&row.play).unwrap(),
            key: u64::MAX,
            seq: u64::MAX,
            timestamp: u64::MAX,
            expires_at_ns: u64::MAX,
        },
    );
    let mint = record(
        b"p",
        &u64::MAX,
        &Request::Mint {
            mode: 1,
            round: u32::MAX,
            log_idx: u32::MAX,
            actor: actor.clone(),
            amount: u128::MAX,
        },
    );
    let lock = record(b"k", &(1u8, u32::MAX, actor.clone()), &u128::MAX);
    let unlock = record(
        b"p",
        &u64::MAX,
        &Request::Unlock {
            mode: 1,
            round: u32::MAX,
            actor: actor.clone(),
            amount: u128::MAX,
        },
    );
    let team = team::Team {
        name: "x".repeat(24),
        captain: actor.clone(),
        members: vec![actor.clone(); 5],
        invites: vec![actor.clone(); 5],
        deposits: vec![(actor.clone(), u128::MAX); 5],
        weight: u128::MAX,
        vault: u128::MAX,
        active_round: Some(u32::MAX),
    };
    let team_bytes = record(b"t", &u32::MAX, &team);
    let membership = record(b"tm", &actor, &u32::MAX);
    let commit = record(
        b"c",
        &(1u8, u32::MAX, u32::MAX),
        &guess::Commit {
            seq: u64::MAX,
            entity: Entity::Team(u32::MAX),
            actor: actor.clone(),
            hash: [u8::MAX; 32],
            stake: u128::MAX,
            block: u64::MAX,
            status: guess::CommitStatus::Correct,
        },
    );
    let check = record(
        b"p",
        &u64::MAX,
        &Request::Guess {
            mode: 1,
            round: u32::MAX,
            commit_seq: u32::MAX,
            expires_at_ns: u64::MAX,
        },
    );
    let platform = record(b"p", &u64::MAX, &Request::Platform { amount: u128::MAX });
    let commit_lifetime_peak = entity_bytes + commit + check + platform;
    println!(
        "MAX COMMIT: entity={entity_bytes}, commit={commit}, check={check}, platform={platform}, lifetime_bound={commit_lifetime_peak}"
    );
    // Conservatively retain both request records and the final records. In an
    // actual transition the consumed request is removed before its replacement.
    let play_lifetime_peak = entity_bytes + log_bytes + seen_bytes + verdict + mint + platform;
    let player_lifetime_peak = player_bytes + withdrawal + registration;
    let team_lifetime_peak = team_bytes + 5 * membership;
    println!(
        "MAX PLAYER: retained={player_bytes}, withdraw={withdrawal}, register={registration}, lifetime_bound={player_lifetime_peak}"
    );
    println!(
        "MAX PLAY: entity_with_five_member_snapshot={entity_bytes}, log={log_bytes}, seen={seen_bytes}, verdict={verdict}, mint={mint}, lifetime_bound={play_lifetime_peak}"
    );
    println!(
        "MAX TEAM: record={team_bytes}, membership={membership}, lifetime_bound={team_lifetime_peak}"
    );
    println!(
        "MAX LOCK: record={lock}, pending_unlock={unlock}, combined_bound={}",
        lock + unlock
    );
    // These are policy ceilings, intentionally independent of exact incidental sizes.
    // Raising a field/record beyond them must fail rather than silently underfund state.
    assert!(
        player_lifetime_peak <= params::ACCOUNT_STORAGE_BYTES,
        "account funding ceiling exceeded"
    );
    assert!(
        play_lifetime_peak <= params::ACTION_STORAGE_BYTES,
        "play funding ceiling exceeded"
    );
    assert!(
        team_lifetime_peak <= params::TEAM_STORAGE_BYTES,
        "team funding ceiling exceeded"
    );
    assert!(
        lock + unlock <= params::ACTION_STORAGE_BYTES,
        "lock funding ceiling exceeded"
    );
    assert!(
        commit_lifetime_peak <= params::ACTION_STORAGE_BYTES,
        "commit funding ceiling exceeded"
    );
}

#[test]
fn maximum_round_and_active_index_budget() {
    let actor: AccountId = "a".repeat(64).parse().unwrap();
    let rule = rule_core::CanonicalRule::new(
        rule_core::Form::Or,
        vec![
            rule_core::Literal {
                atom: rule_core::Atom::new(88).unwrap(),
                negated: true,
            },
            rule_core::Literal {
                atom: rule_core::Atom::new(89).unwrap(),
                negated: true,
            },
        ],
    )
    .unwrap();
    let header = protocol::RoundHeader {
        tier: protocol::Tier::Daily,
        bucket: protocol::Bucket::Common,
        grammar: Hex32([u8::MAX; 32]),
    };
    let round = Round {
        phase: Phase::Settled,
        start_ns: u64::MAX,
        slot_ns: u64::MAX,
        investigation_end_ns: Some(u64::MAX),
        seed: [u8::MAX; 32],
        commit: Some([u8::MAX; 32]),
        header: Some(serde_json::to_string(&header).unwrap()),
        pot: u128::MAX,
        allowance_left: u128::MAX,
        reveal_deadline_ns: u64::MAX,
        begin_pending: true,
        log_len: u32::MAX,
        total_shares: u64::MAX,
        rule: Some(serde_json::to_string(&rule).unwrap()),
        salt: Some([u8::MAX; 32]),
        commit_count: u32::MAX,
        best: Some((u64::MAX, u32::MAX)),
        freeze_ns: Some(u64::MAX),
        pending_checks: u32::MAX,
        base_pot: u128::MAX,
        outcome: Some(settle::Outcome::Solved {
            winner: Entity::Team(u32::MAX),
            account: actor,
        }),
        open_status: settle::OpenStatus::Pending,
        opening_started_ns: Some(u64::MAX),
        sweep_cursor: u32::MAX,
        payout: Some(settle::Payout::Settled {
            winner: u128::MAX,
            per_share: u128::MAX,
        }),
        team_residues: [u64::MAX; 15],
    };
    let bytes = record(b"r", &(1u8, u32::MAX), &round);
    let active_index = borsh::to_vec(&vec![(1u8, u32::MAX); 10]).unwrap().len();
    println!(
        "MAX ROUND: retained_record={bytes}; operator ceiling=1024 bytes per retained round; root active index <= {active_index} bytes at ten rounds"
    );
    assert!(bytes <= 1024, "operator per-round storage ceiling exceeded");
    // Neither the user charges nor the admission cap pay for historical rounds.
    // A deployment quote must include N * 1024 * byte_cost for N retained rounds,
    // plus its actual code/root state and concurrent refundable storage exposure.
}
