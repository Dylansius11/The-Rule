import type { CanonicalRule, LogRow } from '@/game/types';

export interface VerifierRow {
  log_idx: number;
  seq: number;
  play_key: string;
  play: {
    number: number;
    word_id: number;
    minute_digit: number;
    prev: { number: number; word_id: number; gap_bucket: number } | null;
  };
  verdict: boolean;
}

export type Verification =
  { status: 'pass'; matched: number; total: number } | { status: 'fail'; reason: string };

export interface ReplayInput {
  rows: VerifierRow[];
  rule: CanonicalRule;
  salt: string;
  commit: string;
  total: number;
}

export interface AtomCatalog {
  atoms: { id: number; english: string; negated: string; dsl: string }[];
  forms: { id: number; name: string; minLiterals: number; maxLiterals: number }[];
}

export function verifierRow(row: LogRow): VerifierRow {
  if (row.prev && row.prev.gapBucket === undefined) {
    throw new Error(`Missing previous-play gap at index ${row.logIdx}`);
  }
  return {
    log_idx: row.logIdx,
    seq: row.seq,
    play_key: row.playKey,
    play: {
      number: row.number,
      word_id: row.wordId,
      minute_digit: row.minuteDigit,
      prev: row.prev
        ? { number: row.prev.number, word_id: row.prev.wordId, gap_bucket: row.prev.gapBucket! }
        : null,
    },
    verdict: row.verdict,
  };
}
