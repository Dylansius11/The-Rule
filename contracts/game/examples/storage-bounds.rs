//! Serialize actual pending Request variants for request-only trie-record bounds.
//! Run: cargo run -p game --profile fast --example storage-bounds

use game::{Entity, Request};
use near_sdk::{AccountId, serde_json};
use rule_core::{Play, Previous};

fn main() {
    // NEAR account IDs are at most 64 bytes; this one is valid and unescaped.
    let actor: AccountId = "a"
        .repeat(64)
        .parse()
        .expect("valid maximum-length account");
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
    .expect("valid maximum-width play");
    let play_json = serde_json::to_string(&play).expect("serialize play");
    let requests = [
        (
            "Begin",
            true,
            Request::Begin {
                mode: u8::MAX,
                round: u32::MAX,
                expires_at_ns: u64::MAX,
            },
        ),
        (
            "Verdict",
            true,
            Request::Verdict {
                mode: u8::MAX,
                round: u32::MAX,
                entity: Entity::Solo(u32::MAX),
                actor: actor.clone(),
                play: play_json.clone(),
                key: u64::MAX,
                seq: u64::MAX,
                timestamp: u64::MAX,
                expires_at_ns: u64::MAX,
            },
        ),
        (
            "Withdraw",
            false,
            Request::Withdraw {
                actor: actor.clone(),
                amount: u128::MAX,
            },
        ),
        (
            "Guess",
            true,
            Request::Guess {
                mode: u8::MAX,
                round: u32::MAX,
                commit_seq: u32::MAX,
                expires_at_ns: u64::MAX,
            },
        ),
        (
            "Open",
            true,
            Request::Open {
                mode: u8::MAX,
                round: u32::MAX,
                expires_at_ns: u64::MAX,
            },
        ),
        ("Platform", false, Request::Platform { amount: u128::MAX }),
        (
            "Register",
            false,
            Request::Register {
                actor: actor.clone(),
                expires_at_ns: u64::MAX,
            },
        ),
        (
            "Mint",
            false,
            Request::Mint {
                mode: u8::MAX,
                round: u32::MAX,
                log_idx: u32::MAX,
                amount: u128::MAX,
            },
        ),
        (
            "Unlock",
            false,
            Request::Unlock {
                mode: u8::MAX,
                round: u32::MAX,
                actor,
                amount: u128::MAX,
            },
        ),
    ];

    // pending is LookupMap::new(b"p"): its identity-hashed Borsh u64 key
    // is one prefix byte plus eight serialized bytes. Account for trie overhead.
    let key_bytes = b"p".len() + borsh::to_vec(&u64::MAX).expect("serialize key").len();
    let mut largest_referee = 0;
    println!(
        "Request-only trie-record bounds: key={key_bytes} B, trie overhead=40 B, widest valid Play JSON={} B",
        play_json.len()
    );
    for (name, referee, request) in requests {
        let value_bytes = borsh::to_vec(&request).expect("serialize Request").len();
        let record_bytes = key_bytes + value_bytes + 40;
        println!("{name}: value={value_bytes} B, record <= {record_bytes} B");
        if referee {
            largest_referee = largest_referee.max(record_bytes);
        }
    }
    println!(
        "Largest referee request-only record <= {largest_referee} B; multiply by the observed get_params.max_pending_referee_requests for its tracked-request bound."
    );
    println!(
        "Independent field maxima need not be co-reachable; fixed-width numeric maxima do not affect Borsh width. Solo and Team Entity variants have the same fixed-width payload."
    );
    println!(
        "Not a runtime peak or full reserve proof: excludes seen/entity records, callbacks, token/payment concurrency, retained rounds and all other state."
    );
}
