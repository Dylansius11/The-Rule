use game::Game;
use near_sdk::serde_json::json;
use near_sdk::{NearToken, test_utils::VMContextBuilder, testing_env};
use protocol::{Mode, Params};

fn ledger_view(game: &Game) -> near_sdk::serde_json::Value {
    near_sdk::serde_json::to_value(game.get_ledger()).unwrap()
}

fn params() -> Params {
    let limits = json!({"instructions":1000000000,"memory_mb":128,"execution_seconds":5});
    near_sdk::serde_json::from_value(json!({
        "play_fee":"10000","fee_split_bps":[8000,1500,500],"storage_charge_per_play":"100","storage_charge_account":"100","storage_charge_team":"100",
        "stake_bps":[100,200],"stake_min":"100","wrong_return_bps":5000,"solved_split_bps":[4000,4000,1000,1000],"unsolved_split_bps":[4000,5000,1000],
        "genesis_ns":0,"round_period_ns":86400000000000u64,"mode_offset_ns":[0,0],"investigation_max_ns":3600000000000u64,"reveal_window_ns":60000000000u64,"begin_timeout_ns":3600000000000u64,"open_timeout_ns":3600000000000u64,
        "min_reveal_delay_blocks":2,"base_attempts":[25,50],"lock_tiers":[],"attempt_cap":[125,250],"share_cap":[25,50],"round_allowance":"500000","mint_base":"100","max_team_size":5,
        "referee":{"outlayer":"outlayer.testnet","urls":["https://example.com/referee.wasm"],"hash":"0000000000000000000000000000000000000000000000000000000000000000","build_target":"wasm32-wasip2"},
        "resource_limits":{"begin":limits,"verdict":limits,"guess":limits,"open":limits},"outlayer_deposit":{"begin":"0","verdict":"0","guess":"0","open":"0"},"gas_outlayer":100000000000000u64,"gas_callback":30000000000000u64,"gas_mint":10000000000000u64,"token_storage_deposit":"1000","token":"token.testnet","platform":"platform.testnet","chain_id":"testnet"
    })).unwrap()
}

#[test]
fn deposit_accounts_for_storage_and_credit() {
    let mut context = VMContextBuilder::new();
    context.attached_deposit(NearToken::from_yoctonear(1000));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    let ledger = ledger_view(&game);
    assert_eq!(ledger["credit"], "900");
    assert_eq!(ledger["storage_reserve"], "100");
}

#[test]
#[should_panic(expected = "E51")]
fn withdrawal_requires_one_yocto() {
    testing_env!(VMContextBuilder::new().build());
    let mut game = Game::new(params(), true);
    game.withdraw_credit(near_sdk::json_types::U128(1));
}

#[test]
#[should_panic(expected = "E10")]
fn play_requires_investigation() {
    testing_env!(VMContextBuilder::new().build());
    let mut game = Game::new(params(), true);
    game.play(Mode::Solo, 1, "otter".into());
}

#[test]
fn failed_begin_can_be_retried() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context.prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    let request = game.start_round(Mode::Solo);
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"null".to_vec())]
    );
    game.on_begin(request);
    assert_eq!(game.start_round(Mode::Solo), request + 1);
}

#[test]
fn delivered_verdict_splits_fee_and_duplicate_is_free() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(100000));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    let request = game.start_round(Mode::Solo);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(request);
    let ack = game.play(Mode::Solo, 1, "otter".into());
    let request = match ack {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"{\"v\":0}".to_vec())]
    );
    game.on_verdict(request);
    let ledger = ledger_view(&game);
    assert_eq!(ledger["credit"], "89800");
    assert_eq!(ledger["round_pots"], "8000");
    assert_eq!(ledger["compute_float"], "1500");
    assert_eq!(ledger["platform_accrued"], "500");
    assert_eq!(ledger["storage_reserve"], "200");
    let duplicate = game.play(Mode::Solo, 1, "otter".into());
    assert!(matches!(
        duplicate,
        game::PlayAck::Known {
            verdict: false,
            log_idx: 0
        }
    ));
    assert_eq!(ledger, ledger_view(&game));
    assert_eq!(game.get_log(Mode::Solo, 0, 0, 200).len(), 1);
}

#[test]
fn null_verdict_refunds_fee_and_attempt() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(100000));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    let request = game.start_round(Mode::Solo);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(request);
    let before = ledger_view(&game);
    let request = match game.play(Mode::Solo, 2, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"null".to_vec())]
    );
    game.on_verdict(request);
    assert_eq!(ledger_view(&game), before);
    assert_eq!(
        near_sdk::serde_json::to_value(game.get_entity(
            Mode::Solo,
            0,
            context.build().predecessor_account_id
        ))
        .unwrap()["attempts"],
        0
    );
}

#[test]
fn random_verdict_sequences_preserve_credit_and_duplicate_invariants() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    use proptest::prelude::*;
    use proptest::test_runner::{Config, TestRunner};
    let mut runner = TestRunner::new(Config {
        cases: 2000,
        ..Config::default()
    });
    runner.run(&proptest::collection::vec((0u16..1000, 0u8..5), 1..6), |ops| {
        near_sdk::mock::with_mocked_blockchain(|chain| { let _ = chain.take_storage(); });
        let mut context = VMContextBuilder::new();
        context.prepaid_gas(near_sdk::Gas::from_tgas(300)).attached_deposit(NearToken::from_yoctonear(1_000_000));
        testing_env!(context.build());
        let mut game = Game::new(params(), true);
        game.deposit_credit();
        let request = game.start_round(Mode::Solo);
        let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
        testing_env!(context.build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(begin.to_string().into_bytes())]);
        game.on_begin(request);
        let mut next_request = 1u64;
        let mut expected_sum = 1_000_000u128;
        for (number, operation) in ops {
            if operation == 3 {
                context.attached_deposit(NearToken::from_yoctonear(1));
                testing_env!(context.build());
                game.withdraw_credit(near_sdk::json_types::U128(1));
                testing_env!(context.build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(Vec::new())]);
                game.on_withdraw(next_request);
                next_request += 1;
                expected_sum -= 1;
                context.attached_deposit(NearToken::from_yoctonear(0));
                testing_env!(context.build());
            } else if operation == 4 {
                context.block_timestamp(3_600_000_000_000);
                testing_env!(context.build());
                game.advance(Mode::Solo);
            } else {
                let before = ledger_view(&game);
                match game.play(Mode::Solo, number, "otter".into()) {
                    game::PlayAck::Known { .. } => prop_assert_eq!(&before, &ledger_view(&game)),
                    game::PlayAck::Pending {request_id, ..} => {
                        prop_assert_eq!(request_id, next_request);
                        next_request += 1;
                        let bytes = match operation { 0 => b"{\"v\":0}".as_slice(), 1 => b"{\"v\":1}".as_slice(), _ => b"null".as_slice() };
                        testing_env!(context.build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(bytes.to_vec())]);
                        game.on_verdict(request_id);
                        if operation == 2 { prop_assert_eq!(before, ledger_view(&game)); }
                    }
                }
            }
            let ledger = ledger_view(&game);
            let sum: u128 = ["credit","round_pots","carry","compute_float","platform_accrued","storage_reserve","pending_credit"].iter().map(|name| ledger[name].as_str().unwrap().parse::<u128>().unwrap()).sum();
            let balance: u128 = ledger["balance"].as_str().unwrap().parse().unwrap();
            let locked: u128 = ledger["locked_storage"].as_str().unwrap().parse().unwrap();
            prop_assert_eq!(sum, expected_sum);
            prop_assert!(balance >= sum + locked);
            if operation == 4 { break; }
        }
        Ok(())
    }).unwrap();
}

#[test]
fn late_verdict_and_duplicate_callback_refund_once() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(100000));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    let begin_request = game.start_round(Mode::Solo);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(begin_request);
    let before = ledger_view(&game);
    let request = match game.play(Mode::Solo, 2, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    context.block_timestamp(3_600_000_000_000);
    testing_env!(context.build());
    game.advance(Mode::Solo);
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"{\"v\":1}".to_vec())]
    );
    game.on_verdict(request);
    assert_eq!(ledger_view(&game), before);
    game.on_verdict(request);
    assert_eq!(ledger_view(&game), before);
    assert!(game.get_log(Mode::Solo, 0, 0, 200).is_empty());
}

#[test]
fn promise_failure_refunds_and_restores_attempt() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(100000));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    let begin_request = game.start_round(Mode::Solo);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(begin_request);
    let before = ledger_view(&game);
    let request = match game.play(Mode::Solo, 4, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    game.on_verdict(request);
    assert_eq!(ledger_view(&game), before);
    assert_eq!(
        near_sdk::serde_json::to_value(game.get_entity(
            Mode::Solo,
            0,
            context.build().predecessor_account_id
        ))
        .unwrap()["attempts"],
        0
    );
}

#[test]
fn distinct_players_settle_out_of_order() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig, test_utils::accounts};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(100000))
        .predecessor_account_id(accounts(0));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    let begin_request = game.start_round(Mode::Solo);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(begin_request);
    let first = match game.play(Mode::Solo, 10, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    context.predecessor_account_id(accounts(1));
    testing_env!(context.build());
    game.deposit_credit();
    let second = match game.play(Mode::Solo, 11, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"{\"v\":1}".to_vec())]
    );
    game.on_verdict(second);
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(b"{\"v\":0}".to_vec())]
    );
    game.on_verdict(first);
    let rows = game.get_log(Mode::Solo, 0, 0, 200);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].seq, 1);
    assert!(rows[0].verdict);
    assert_eq!(rows[1].seq, 0);
    assert!(!rows[1].verdict);
    let json = near_sdk::serde_json::to_vec(&rows[0]).unwrap();
    let decoded: protocol::events::LogRow = near_sdk::serde_json::from_slice(&json).unwrap();
    assert_eq!(decoded, rows[0]);
    let logs = near_sdk::test_utils::get_logs();
    let event: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(logs[0].strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    let payload: protocol::events::PlaySettled =
        near_sdk::serde_json::from_value(event["data"][0].clone()).unwrap();
    assert_eq!(payload.row, rows[1]);
}

#[test]
#[should_panic(expected = "E22")]
fn verdict_requires_funded_compute() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(100000));
    testing_env!(context.build());
    let mut p = params();
    p.outlayer_deposit.verdict.0 = 1;
    let mut game = Game::new(p, true);
    game.deposit_credit();
    let request = game.start_round(Mode::Solo);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(request);
    game.play(Mode::Solo, 1, "otter".into());
}

#[test]
#[should_panic(expected = "E11")]
fn production_rejects_genesis_before_two_hours() {
    testing_env!(VMContextBuilder::new().block_timestamp(0).build());
    let mut p = params();
    p.genesis_ns = 119 * 60_000_000_000;
    p.reveal_window_ns = 10 * 60_000_000_000;
    Game::new(p, false);
}

#[test]
fn production_accepts_two_hours_and_demo_accepts_short_schedule() {
    testing_env!(VMContextBuilder::new().block_timestamp(0).build());
    let mut p = params();
    p.genesis_ns = 120 * 60_000_000_000;
    p.reveal_window_ns = 10 * 60_000_000_000;
    let production = Game::new(p.clone(), false);
    assert_eq!(
        near_sdk::serde_json::to_value(production.get_params()).unwrap()["demo"],
        false
    );
    p.genesis_ns = 0;
    p.round_period_ns = 15 * 60_000_000_000;
    p.reveal_window_ns = 2 * 60_000_000_000;
    p.begin_timeout_ns = 5 * 60_000_000_000;
    let demo = Game::new(p, true);
    assert_eq!(
        near_sdk::serde_json::to_value(demo.get_params()).unwrap()["demo"],
        true
    );
}

#[test]
#[should_panic(expected = "E32")]
fn team_play_without_team_is_rejected() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context.prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    let request = game.start_round(Mode::Team);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(request);
    game.play(Mode::Team, 1, "otter".into());
}

#[test]
fn borsh_params_preserve_protocol_json() {
    testing_env!(VMContextBuilder::new().build());
    let p = params();
    let mut expected = near_sdk::serde_json::to_value(&p).unwrap();
    expected["demo"] = json!(true);
    let game = Game::new(p, true);
    assert_eq!(
        near_sdk::serde_json::to_value(game.get_params()).unwrap(),
        expected
    );
}

#[test]
fn begin_failure_past_timeout_cancels_and_restores_carry() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(10));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.seed_pot(Mode::Solo);
    let request = game.start_round(Mode::Solo);
    context.block_timestamp(3_600_000_000_000);
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    game.on_begin(request);
    let round = near_sdk::serde_json::to_value(game.get_round(Mode::Solo, None)).unwrap();
    assert_eq!(round["phase"], "Cancelled");
    assert_eq!(ledger_view(&game)["carry"], "10");
    assert_eq!(ledger_view(&game)["round_pots"], "0");
}

#[test]
fn malformed_verdict_refunds_without_log() {
    use near_sdk::{PromiseResult, RuntimeFeesConfig};
    let mut context = VMContextBuilder::new();
    context
        .prepaid_gas(near_sdk::Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(100000));
    testing_env!(context.build());
    let mut game = Game::new(params(), true);
    game.deposit_credit();
    let begin_request = game.start_round(Mode::Solo);
    let begin = json!({"commit":"1111111111111111111111111111111111111111111111111111111111111111","header":{"tier":"daily","bucket":"rare","grammar":"2222222222222222222222222222222222222222222222222222222222222222"}});
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(begin.to_string().into_bytes())]
    );
    game.on_begin(begin_request);
    let before = ledger_view(&game);
    let request = match game.play(Mode::Solo, 6, "otter".into()) {
        game::PlayAck::Pending { request_id, .. } => request_id,
        _ => panic!("expected pending"),
    };
    testing_env!(
        context.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(
            b"{\"v\":1,\"extra\":true}".to_vec()
        )]
    );
    game.on_verdict(request);
    assert_eq!(ledger_view(&game), before);
    assert!(game.get_log(Mode::Solo, 0, 0, 200).is_empty());
}
