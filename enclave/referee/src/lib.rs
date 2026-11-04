//! Stateless OutLayer referee. Errors are deliberately opaque and never emitted.
use protocol::{Bucket, Hex32, RefereeRequest, RefereeResponse, RoundHeader, Tier, Verdict};

#[cfg(all(test, feature = "demo"))]
mod demo_tests;
#[cfg(all(test, not(feature = "demo")))]
mod tests;

/// Maximum complete stdin request, including JSON framing.
pub const MAX_INPUT: usize = 4096;

/// Uniform failure: the guest exits without output.
#[derive(Debug)]
pub struct Failure;

/// The only secret-bearing operation, provided by OutLayer in production.
pub trait Mac {
    fn mac(&self, data: &[u8]) -> Result<[u8; 32], Failure>;
}

/// Parse and process one complete request. No output is produced on failure.
pub fn execute(input: &[u8], host: &impl Mac) -> Result<Vec<u8>, Failure> {
    if input.len() > MAX_INPUT {
        return Err(Failure);
    }
    let request: RefereeRequest = serde_json::from_slice(input).map_err(|_| Failure)?;
    let (chain, game, mode, round, seed) = match &request {
        RefereeRequest::Begin {
            chain,
            game,
            mode,
            round,
            seed,
            ..
        }
        | RefereeRequest::Verdict {
            chain,
            game,
            mode,
            round,
            seed,
            ..
        }
        | RefereeRequest::Guess {
            chain,
            game,
            mode,
            round,
            seed,
            ..
        }
        | RefereeRequest::Open {
            chain,
            game,
            mode,
            round,
            seed,
            ..
        } => (chain, game, *mode, *round, seed),
    };
    if chain != "testnet"
        || !(2..=64).contains(&game.len())
        || !game.ends_with(".testnet")
        || !game
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
        || !game.as_bytes()[0].is_ascii_alphanumeric()
        || game
            .as_bytes()
            .windows(2)
            .any(|w| b"._-".contains(&w[0]) && b"._-".contains(&w[1]))
    {
        return Err(Failure);
    }
    let context = protocol::referee_context(chain, game, mode, round, &seed.0);
    let key = host.mac(&context)?;
    let mut salt_context = Vec::with_capacity(protocol::SALT_DOMAIN.len() + context.len());
    salt_context.extend_from_slice(protocol::SALT_DOMAIN);
    salt_context.extend_from_slice(&context);
    let salt = host.mac(&salt_context)?;
    #[cfg(not(feature = "demo"))]
    let (rule, bucket) = {
        let mut seed = [0u8; 36];
        seed[..32].copy_from_slice(&key);
        seed[32..].copy_from_slice(b"rule");
        rule_core::sample(&seed)
    };
    #[cfg(feature = "demo")]
    let (rule, bucket) = {
        let _ = key;
        let demo = std::env::var("RULE_DEMO").map_err(|_| Failure)?;
        if demo.len() > MAX_INPUT {
            return Err(Failure);
        }
        let rule: rule_core::CanonicalRule = serde_json::from_str(&demo).map_err(|_| Failure)?;
        let bucket = rule_core::classify(&rule).ok_or(Failure)?;
        (rule, bucket)
    };
    let commitment = protocol::round_commitment(&rule, &salt);
    let response = match request {
        RefereeRequest::Begin { .. } => RefereeResponse::Begin {
            commit: commitment,
            header: RoundHeader {
                tier: Tier::Daily,
                bucket: match bucket {
                    rule_core::Bucket::Rare => Bucket::Rare,
                    rule_core::Bucket::Mid => Bucket::Mid,
                    rule_core::Bucket::Common => Bucket::Common,
                },
                grammar: Hex32(protocol::grammar_hash()),
            },
        },
        RefereeRequest::Verdict { commit, play, .. } if commit == commitment => {
            RefereeResponse::Verdict {
                v: if rule_core::eval(&rule, &play) {
                    Verdict::Yes
                } else {
                    Verdict::No
                },
            }
        }
        RefereeRequest::Guess { commit, guess, .. } if commit == commitment => {
            RefereeResponse::Guess {
                correct: rule_core::equivalent(&rule, &guess.0),
            }
        }
        RefereeRequest::Open { commit, .. } if commit == commitment => RefereeResponse::Open {
            rule,
            salt: Hex32(salt),
        },
        _ => return Err(Failure),
    };
    serde_json::to_vec(&response).map_err(|_| Failure)
}
