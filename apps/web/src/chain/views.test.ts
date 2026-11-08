import { describe, expect, it } from 'vitest';
import fixture from '../verify/fixtures/solo-round-0.json';
import { decodeLogRow, decodeRound, decodeTokenOperation } from './views';
describe('chain view decoding', () => {
  it('decodes captured settled round and its first log row', () => {
    const round = decodeRound(fixture.round);
    expect(round.phase).toBe('Settled');
    expect(round.logLen).toBe(52);
    expect(round.pot).toBe(BigInt(fixture.round.pot));
    const wire = fixture.rows[0]!;
    const words = Array.from({ length: 128 }, (_, i) => `word-${i}`);
    const row = decodeLogRow(wire, words);
    expect(row.word).toBe(words[wire.play.word_id]);
    expect(row.minted).toBe(BigInt(wire.minted));
    expect(row.minuteDigit).toBe(wire.play.minute_digit);
  });
  it('decodes token operation base units exactly', () => {
    expect(
      decodeTokenOperation({
        operation_id: 12,
        kind: 'unlock',
        account_id: 'alice.testnet',
        amount: '123456789012345678901',
      }),
    ).toEqual({
      operationId: 12,
      kind: 'unlock',
      accountId: 'alice.testnet',
      amount: 123456789012345678901n,
    });
    expect(() =>
      decodeTokenOperation({
        operation_id: Number.MAX_SAFE_INTEGER + 1,
        kind: 'mint',
        account_id: 'alice.testnet',
        amount: '1',
      }),
    ).toThrow('Invalid token operation ID');
  });
});
