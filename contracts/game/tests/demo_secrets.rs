//! Demo profile references cannot enable secret inputs on non-demo deployments.
mod common;
use common::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env};
use protocol::params::SecretsRef;

fn reset() {
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    testing_env!(VMContextBuilder::new().build());
}

#[test]
fn production_rejects_a_demo_secret_profile() {
    reset();
    let mut p = game::params::production_defaults(params());
    p.genesis_ns = 7_200_000_000_000;
    p.referee.demo_secrets_ref = Some(SecretsRef {
        profile: "demo".into(),
        account_id: "therule.testnet".into(),
    });
    assert!(
        panic_text(|| {
            game::Game::new(p, false);
        })
        .contains("E11")
    );
}

#[test]
fn demo_rejects_unbounded_or_invalid_secret_references() {
    for (profile, owner) in [
        ("".to_owned(), "therule.testnet".to_owned()),
        ("x".repeat(65), "therule.testnet".to_owned()),
        ("../demo".to_owned(), "therule.testnet".to_owned()),
        ("demo space".to_owned(), "therule.testnet".to_owned()),
        ("demo".to_owned(), "therule.near".to_owned()),
        ("demo".to_owned(), "bad..testnet".to_owned()),
        ("demo".to_owned(), format!("{}.testnet", "x".repeat(57))),
    ] {
        reset();
        let mut p = params();
        p.referee.demo_secrets_ref = Some(SecretsRef {
            profile,
            account_id: owner,
        });
        assert!(
            panic_text(|| {
                game::Game::new(p, true);
            })
            .contains("E11")
        );
    }
}
