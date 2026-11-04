//! Strict wire types and domain-separated commitment encoding.
#![no_std]
#![forbid(unsafe_code)]
extern crate alloc;

#[cfg(test)]
mod tests;

pub mod events;
pub mod params;
pub use params::Params;

use alloc::{string::String, vec::Vec};
pub use rule_core::{CanonicalRule, Play, PlayKey};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use sha2::{Digest, Sha256};

/// Domain for player guess commitments.
pub const COMMIT_DOMAIN: &[u8] = b"the-rule/commit/v1";
/// Domain for referee rule derivation.
pub const RULE_DOMAIN: &[u8] = b"the-rule/v1";
/// Domain for referee salt derivation.
pub const SALT_DOMAIN: &[u8] = b"salt";

/// Canonical referee MAC context: domain, length-prefixed chain and game,
/// mode byte, little-endian round, then the 32-byte round seed.
pub fn referee_context(
    chain: &str,
    game: &str,
    mode: Mode,
    round: u32,
    seed: &[u8; 32],
) -> Vec<u8> {
    let mut result = Vec::new();
    result.extend_from_slice(RULE_DOMAIN);
    for s in [chain, game] {
        result.extend_from_slice(
            &u32::try_from(s.len())
                .expect("string length exceeds u32")
                .to_le_bytes(),
        );
        result.extend_from_slice(s.as_bytes());
    }
    result.push(mode as u8);
    result.extend_from_slice(&round.to_le_bytes());
    result.extend_from_slice(seed);
    result
}

/// Hash of the daily g1 grammar identifier, word list and allowed atom IDs.
pub fn grammar_hash() -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"the-rule/grammar/g1/daily\n");
    for word in rule_core::words::WORDS {
        hash.update(word.as_bytes());
        hash.update(b"\n");
    }
    for id in 0u8..90 {
        hash.update([id]);
    }
    hash.finalize().into()
}

/// A 32-byte value represented as exactly 64 lowercase hexadecimal characters.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Hex32(pub [u8; 32]);
impl Serialize for Hex32 {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut result = String::with_capacity(64);
        for b in self.0 {
            result.push(HEX[usize::from(b >> 4)] as char);
            result.push(HEX[usize::from(b & 15)] as char);
        }
        s.serialize_str(&result)
    }
}
impl<'de> Deserialize<'de> for Hex32 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = String::deserialize(d)?;
        let bytes = value.as_bytes();
        if bytes.len() != 64 {
            return Err(D::Error::custom("expected 32-byte hex"));
        }
        fn nibble(b: u8) -> Option<u8> {
            match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                _ => None,
            }
        }
        let mut out = [0; 32];
        for (i, chunk) in bytes.chunks_exact(2).enumerate() {
            out[i] = nibble(chunk[0]).ok_or_else(|| D::Error::custom("invalid hex"))? << 4
                | nibble(chunk[1]).ok_or_else(|| D::Error::custom("invalid hex"))?;
        }
        Ok(Self(out))
    }
}
/// Mode encoded as the numeric byte 0 (solo) or 1 (team).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Mode {
    Solo = 0,
    Team = 1,
}
impl Serialize for Mode {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u8(*self as u8)
    }
}
impl<'de> Deserialize<'de> for Mode {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match u8::deserialize(d)? {
            0 => Ok(Self::Solo),
            1 => Ok(Self::Team),
            _ => Err(D::Error::custom("invalid mode")),
        }
    }
}
/// An account or team identifier in a commitment.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Entity {
    Solo(u32),
    Team(u32),
}
/// Inputs to a guess commitment, bound to chain, game, round, actor and entity.
pub struct CommitPreimage<'a> {
    pub chain: &'a str,
    pub game: &'a str,
    pub mode: Mode,
    pub round: u32,
    pub actor: &'a str,
    pub entity: Entity,
    pub guess: &'a CanonicalRule,
    pub salt: &'a [u8; 32],
}
/// Build the exact guess commitment preimage. Strings have a u32 little-endian byte length.
pub fn commit_preimage(input: &CommitPreimage<'_>) -> Vec<u8> {
    fn append_string(out: &mut Vec<u8>, s: &str) {
        let n = u32::try_from(s.len()).expect("string length exceeds u32");
        out.extend_from_slice(&n.to_le_bytes());
        out.extend_from_slice(s.as_bytes());
    }
    let mut out = Vec::new();
    out.extend_from_slice(COMMIT_DOMAIN);
    append_string(&mut out, input.chain);
    append_string(&mut out, input.game);
    out.push(input.mode as u8);
    out.extend_from_slice(&input.round.to_le_bytes());
    append_string(&mut out, input.actor);
    let (tag, id) = match input.entity {
        Entity::Solo(id) => (0, id),
        Entity::Team(id) => (1, id),
    };
    out.push(tag);
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&rule_core::canonical::encode(input.guess));
    out.extend_from_slice(input.salt);
    out
}
/// SHA-256 of the canonical rule bytes followed by the round salt.
pub fn round_commitment(rule: &CanonicalRule, salt: &[u8; 32]) -> Hex32 {
    let mut h = Sha256::new();
    h.update(rule_core::canonical::encode(rule));
    h.update(salt);
    Hex32(h.finalize().into())
}
/// The grammar version accepted by the referee.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Grammar {
    #[serde(rename = "g1")]
    G1,
}
/// Referee requests. Each operation has an exact field set.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub enum RefereeRequest {
    Begin {
        g: Grammar,
        chain: String,
        game: String,
        mode: Mode,
        round: u32,
        seed: Hex32,
        commit: (),
    },
    Verdict {
        g: Grammar,
        chain: String,
        game: String,
        mode: Mode,
        round: u32,
        seed: Hex32,
        commit: Hex32,
        play: Play,
    },
    Guess {
        g: Grammar,
        chain: String,
        game: String,
        mode: Mode,
        round: u32,
        seed: Hex32,
        commit: Hex32,
        guess: RuleHex,
    },
    Open {
        g: Grammar,
        chain: String,
        game: String,
        mode: Mode,
        round: u32,
        seed: Hex32,
        commit: Hex32,
    },
}
/// Canonical rule bytes encoded as lowercase hex.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuleHex(pub CanonicalRule);
impl Serialize for RuleHex {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let bytes = rule_core::canonical::encode(&self.0);
        let mut out = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            out.push(HEX[usize::from(b >> 4)] as char);
            out.push(HEX[usize::from(b & 15)] as char);
        }
        s.serialize_str(&out)
    }
}
impl<'de> Deserialize<'de> for RuleHex {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        let bytes = s.as_bytes();
        if bytes.len() != 12 && bytes.len() != 16 {
            return Err(D::Error::custom("invalid rule length"));
        }
        fn nibble(b: u8) -> Option<u8> {
            match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                _ => None,
            }
        }
        let mut raw = Vec::with_capacity(bytes.len() / 2);
        for p in bytes.chunks_exact(2) {
            raw.push(
                nibble(p[0]).ok_or_else(|| D::Error::custom("invalid hex"))? << 4
                    | nibble(p[1]).ok_or_else(|| D::Error::custom("invalid hex"))?,
            );
        }
        rule_core::canonical::decode(&raw)
            .map(Self)
            .map_err(|_| D::Error::custom("invalid rule"))
    }
}
/// Daily tier.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Tier {
    #[serde(rename = "daily")]
    Daily,
}
/// Public acceptance-rate bucket.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Bucket {
    Rare,
    Mid,
    Common,
}
/// Public round header.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoundHeader {
    pub tier: Tier,
    pub bucket: Bucket,
    pub grammar: Hex32,
}
/// A strict numeric verdict bit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Verdict {
    No,
    Yes,
}
impl Serialize for Verdict {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u8(u8::from(*self == Self::Yes))
    }
}
impl<'de> Deserialize<'de> for Verdict {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match u8::deserialize(d)? {
            0 => Ok(Self::No),
            1 => Ok(Self::Yes),
            _ => Err(D::Error::custom("invalid verdict")),
        }
    }
}
/// The four strictly parsed referee output shapes; JSON null is a failure, not a response.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum RefereeResponse {
    Begin { commit: Hex32, header: RoundHeader },
    Verdict { v: Verdict },
    Guess { correct: bool },
    Open { rule: CanonicalRule, salt: Hex32 },
}
