import type { LogRow } from '@/game/types';

/**
 * Earlier plays of this round with the same number and word, oldest first.
 *
 * A repeat is free only when the minute digit and the player's previous play match too (the
 * contract keys a play on all of them). A rule may read the minute digit or the previous play, so a
 * repeat with different context is a new paid probe, not a duplicate. The desk uses this to say so
 * before the player pays for it.
 */
export function sameFace(rows: readonly LogRow[], number: number, word: string | null): LogRow[] {
  if (word === null) return [];
  return rows.filter(row => row.number === number && row.word === word);
}
