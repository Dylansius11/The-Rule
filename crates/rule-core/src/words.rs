//! Stable word IDs: category-major, eight words per category.

/// Categories in ID order. A word's category is its ID divided by eight.
pub const CATEGORIES: [&str; 16] = [
    "animal", "color", "food", "tool", "place", "body", "weather", "music", "space", "sport",
    "feeling", "myth", "metal", "plant", "vehicle", "chain",
];
/// The immutable g1 word list; indexes are wire IDs.
pub const WORDS: [&str; 128] = [
    "otter", "fox", "bear", "wolf", "heron", "eagle", "tiger", "whale", "red", "blue", "green",
    "gold", "jade", "pink", "black", "white", "apple", "bread", "rice", "pear", "lemon", "olive",
    "peach", "plum", "hammer", "saw", "wrench", "drill", "chisel", "clamp", "file", "pliers",
    "forest", "river", "mountain", "island", "valley", "desert", "cave", "beach", "hand", "foot",
    "eye", "ear", "nose", "heart", "arm", "leg", "rain", "snow", "wind", "cloud", "storm", "fog",
    "hail", "sun", "song", "drum", "flute", "harp", "piano", "violin", "note", "chord", "star",
    "moon", "planet", "orbit", "comet", "nova", "solar", "cosmos", "tennis", "soccer", "golf",
    "rugby", "hockey", "boxing", "rowing", "cricket", "joy", "hope", "calm", "fear", "anger",
    "pride", "trust", "wonder", "dragon", "phoenix", "hydra", "griffin", "titan", "sphinx",
    "satyr", "nymph", "iron", "copper", "silver", "tin", "zinc", "nickel", "lead", "bronze", "oak",
    "pine", "fern", "moss", "rose", "lily", "bamboo", "maple", "car", "train", "boat", "plane",
    "bicycle", "truck", "bus", "scooter", "shard", "gas", "epoch", "block", "wallet", "key",
    "stake", "nonce",
];

/// Resolve a word after trimming ASCII whitespace and folding ASCII case.
/// Non-ASCII input and words outside the catalog are rejected.
pub fn normalize(input: &str) -> Option<u8> {
    if !input.is_ascii() {
        return None;
    }
    let input = input.trim_ascii();
    WORDS
        .iter()
        .position(|word| input.eq_ignore_ascii_case(word))
        .map(|id| id as u8)
}

/// Return the catalog word for a valid ID.
pub fn word(id: u8) -> Option<&'static str> {
    WORDS.get(usize::from(id)).copied()
}
