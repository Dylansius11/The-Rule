import { describe, expect, it } from 'vitest';
import { formatNear, formatRule, parseNear, shortHash } from './format';
describe('amount formatting', () => {
  it('round trips exact NEAR amounts', () => {
    for (const value of [0n, 1n, 10n ** 24n, 123456789012345678901234567890n])
      expect(parseNear(formatNear(value))).toBe(value);
  });
  it('preserves 18 decimal RULE units', () => {
    expect(formatRule(1n)).toBe('0.000000000000000001');
    expect(formatRule(1234567890000000000n)).toBe('1.23456789');
  });
  it('rejects invalid and over-precision amounts', () => {
    for (const text of ['', '-1', '1e3', '.1', '1.', '0.0000000000000000000000001'])
      expect(() => parseNear(text)).toThrow();
  });
  it('handles display precision and hashes', () => {
    expect(formatNear(1234567890000000000000000n, 4)).toBe('1.2345');
    expect(shortHash('1234567890abcdefghijkl')).toBe('12345678…ghijkl');
  });
});
