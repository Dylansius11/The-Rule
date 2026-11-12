// Synthetic log, not chain data. Word IDs refer to the contract's immutable word list.
export const syntheticRows = Array.from({ length: 10_000 }, (_, i) => ({
  log_idx: i,
  seq: i + 1,
  play_key: i.toString(16).padStart(64, '0'),
  entity_tag: 0,
  entity_id: i,
  actor: `player${i}.testnet`,
  account: `player${i}.testnet`,
  play: { number: i % 1000, word_id: Math.floor(i / 1000), minute_digit: i % 10, prev: null },
  verdict: i % 3 === 0,
  minted: i % 3 === 0 ? '25000000000000000000' : '0',
}));
