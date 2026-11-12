import { describe, expect, it } from 'vitest';
import { LocalPlayError } from '@/chain/errors';
import { buildPlayContext, detectRefund, findPlayRow, parsePlayAck } from './play-helpers';
import type { EntityLine, LogRow } from './types';

const line: EntityLine = { number: 123, wordId: 1, word: 'pear', atMs: 0 };
const row: LogRow = {
  logIdx: 3,
  seq: 9,
  playKey: 'key',
  entityTag: 0,
  entityId: 1,
  actor: 1,
  account: 'a.testnet',
  number: 1,
  wordId: 0,
  word: 'apple',
  minuteDigit: 1,
  prev: null,
  verdict: true,
  minted: 0n,
};

describe('play context', () => {
  it('uses the final block minute and exact previous line gap boundaries', () => {
    expect(buildPlayContext({ number: 1, word: ' APPLE ' }, ['apple', 'pear'], null, 60_000)).toEqual({
      number: 1,
      word_id: 0,
      minute_digit: 1,
      prev: null,
    });
    expect(buildPlayContext({ number: 1, word: 'apple' }, ['apple'], line, 59_999).prev?.gap_bucket).toBe(0);
    expect(buildPlayContext({ number: 1, word: 'apple' }, ['apple'], line, 60_000).prev?.gap_bucket).toBe(1);
    expect(buildPlayContext({ number: 1, word: 'apple' }, ['apple'], line, 3_600_000).prev?.gap_bucket).toBe(
      2,
    );
  });

  it('rejects invalid input locally', () => {
    expect(() => buildPlayContext({ number: 1000, word: 'apple' }, ['apple'], null, 0)).toThrow(
      LocalPlayError,
    );
    expect(() => buildPlayContext({ number: 1, word: 'unknown' }, ['apple'], null, 0)).toThrow(
      LocalPlayError,
    );
  });

  it('requires an identifiable acknowledgement and matching chain row', () => {
    expect(parsePlayAck(null)).toBeNull();
    expect(parsePlayAck({ status: 'Pending' })).toBeNull();
    expect(parsePlayAck({ status: 'Pending', seq: 9 })).toEqual({ status: 'Pending', seq: 9 });
    expect(findPlayRow([row], { status: 'Pending', seq: 8 })).toBeUndefined();
    expect(findPlayRow([row], { status: 'Pending', seq: 9 })).toEqual(row);
    expect(findPlayRow([row], { status: 'Known', logIdx: 3 })).toEqual(row);
  });

  it('never calls pre-receipt unchanged views a refund; requires observed pending or debit and reversal', () => {
    const ack = { status: 'Pending' as const, seq: 9 };
    expect(detectRefund(ack, false, false, 10n, 10n, false)).toBe(false);
    expect(detectRefund(ack, false, false, 10n, 10n, true)).toBe(true);
    expect(detectRefund(ack, true, false, 10n, 10n, true)).toBe(false);
    expect(detectRefund(ack, false, undefined, 10n, 10n, true)).toBe(false);
    expect(detectRefund(ack, false, false, 10n, 9n, true)).toBe(false);
    expect(detectRefund({ status: 'Known', logIdx: 3 }, false, false, 10n, 10n, true)).toBe(false);
  });
});
