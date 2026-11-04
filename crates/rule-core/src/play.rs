//! Validated public play and its injective packed key.
use serde::{Deserialize, Deserializer, Serialize};

/// Previous accepted play and elapsed-time bucket (0, 1, or 2).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Previous {
    pub number: u16,
    pub word_id: u8,
    pub gap_bucket: u8,
}

/// A valid daily-tier play. Construct through [`Play::new`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct Play {
    number: u16,
    word_id: u8,
    minute_digit: u8,
    prev: Option<Previous>,
}

/// Invalid play field.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlayError {
    Number,
    Word,
    Minute,
    PreviousNumber,
    PreviousWord,
    Gap,
}
/// Packed key; fields occupy bits 0..40 in specification order, least significant first.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct PlayKey(pub u64);

impl Play {
    /// Validate every field; a missing previous play has no previous fields or gap.
    pub fn new(
        number: u16,
        word_id: u8,
        minute_digit: u8,
        prev: Option<Previous>,
    ) -> Result<Self, PlayError> {
        if number > 999 {
            return Err(PlayError::Number);
        }
        if word_id >= 128 {
            return Err(PlayError::Word);
        }
        if minute_digit >= 10 {
            return Err(PlayError::Minute);
        }
        if let Some(p) = prev {
            if p.number > 999 {
                return Err(PlayError::PreviousNumber);
            }
            if p.word_id >= 128 {
                return Err(PlayError::PreviousWord);
            }
            if p.gap_bucket >= 3 {
                return Err(PlayError::Gap);
            }
        }
        Ok(Self {
            number,
            word_id,
            minute_digit,
            prev,
        })
    }
    /// Current number, in 0..=999.
    pub const fn number(self) -> u16 {
        self.number
    }
    /// Current word ID, in 0..128.
    pub const fn word_id(self) -> u8 {
        self.word_id
    }
    /// Minute-of-hour modulo ten.
    pub const fn minute_digit(self) -> u8 {
        self.minute_digit
    }
    /// Last accepted play and gap, if any.
    pub const fn previous(self) -> Option<Previous> {
        self.prev
    }
    /// Encode every verdict-relevant field without collisions.
    pub fn play_key(self) -> PlayKey {
        let mut n = u64::from(self.number)
            | (u64::from(self.word_id) << 10)
            | (u64::from(self.minute_digit) << 17);
        if let Some(p) = self.prev {
            n |= 1 << 21
                | u64::from(p.number) << 22
                | u64::from(p.word_id) << 32
                | u64::from(p.gap_bucket) << 39;
        }
        PlayKey(n)
    }
}
impl<'de> Deserialize<'de> for Play {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            number: u16,
            word_id: u8,
            minute_digit: u8,
            prev: Option<Previous>,
        }
        let w = Wire::deserialize(d)?;
        Self::new(w.number, w.word_id, w.minute_digit, w.prev)
            .map_err(|_| serde::de::Error::custom("invalid play"))
    }
}
