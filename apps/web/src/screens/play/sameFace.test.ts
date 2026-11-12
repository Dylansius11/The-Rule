import { describe, expect, it } from 'vitest';
import type { LogRow } from '@/game/types';
import { sameFace } from './sameFace';

const row = (logIdx: number, number: number, word: string, minuteDigit: number): LogRow => ({
  logIdx,
  seq: logIdx,
  playKey: String(logIdx),
  entityTag: 1,
  entityId: 2,
  account: 'putra-dev.testnet',
  actor: 0,
  number,
  wordId: 0,
  word,
  minuteDigit,
  prev: null,
  verdict: true,
  minted: 0n,
});

describe('sameFace', () => {
  const rows = [row(0, 417, 'black', 4), row(1, 427, 'hydra', 5), row(2, 417, 'black', 8)];

  it('finds every earlier play with the same number and word, whatever the minute', () => {
    expect(sameFace(rows, 417, 'black').map(r => r.logIdx)).toEqual([0, 2]);
  });

  it('needs both the number and the word to match', () => {
    expect(sameFace(rows, 417, 'hydra')).toEqual([]);
    expect(sameFace(rows, 418, 'black')).toEqual([]);
  });

  it('finds nothing before a word is chosen', () => {
    expect(sameFace(rows, 417, null)).toEqual([]);
  });
});
