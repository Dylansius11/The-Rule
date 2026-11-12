import { describe, expect, it } from 'vitest';
import { playReducer } from './play-state';
import type { LogRow, PlayState } from './types';
const input = { number: 12, word: 'apple' };
const row: LogRow = {
  logIdx: 0,
  seq: 1,
  playKey: '1',
  entityTag: 0,
  entityId: 0,
  actor: 0,
  account: 'a.testnet',
  number: 12,
  wordId: 0,
  word: 'apple',
  minuteDigit: 1,
  prev: null,
  verdict: true,
  minted: 0n,
};
const start = (): PlayState => playReducer({ kind: 'idle' }, { type: 'start', input });
const pending = (): PlayState =>
  playReducer(playReducer(start(), { type: 'sign' }), { type: 'pending', txHash: null, sinceMs: 1 });
describe('play state', () => {
  it('recognizes a free known duplicate', () =>
    expect(playReducer(start(), { type: 'known', row }).kind).toBe('known'));
  it('recognizes a duplicate returned after wallet signing', () =>
    expect(playReducer(pending(), { type: 'known', row }).kind).toBe('known'));
  it('never shows a verdict before a row', () => {
    const state = pending();
    expect(state.kind).toBe('pending');
    expect(playReducer(state, { type: 'sign' })).toEqual(state);
    expect(playReducer(state, { type: 'row', row }).kind).toBe('accepted');
    expect(playReducer(state, { type: 'row', row: { ...row, verdict: false } }).kind).toBe('rejected');
  });
  it('handles refund and error', () => {
    expect(playReducer(pending(), { type: 'refund' }).kind).toBe('refunded');
    expect(
      playReducer(start(), {
        type: 'error',
        error: { code: 'E10', title: 'phase', funds: 'No charge', next: 'Wait', retryable: true },
      }).kind,
    ).toBe('error');
  });
  it('shows the recorded verdict when the ledger beats the send path, and keeps it over a late error', () => {
    const signing = playReducer(start(), { type: 'sign' });
    expect(playReducer(start(), { type: 'row', row }).kind).toBe('prechecking');
    const shown = playReducer(signing, { type: 'row', row });
    expect(shown).toMatchObject({ kind: 'accepted', txHash: null });
    const error = { code: 'X', title: 'late', funds: 'No charge', next: 'Wait', retryable: true };
    expect(playReducer(shown, { type: 'error', error })).toEqual(shown);
  });
});
