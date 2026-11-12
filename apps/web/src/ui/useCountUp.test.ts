import { describe, expect, it } from 'vitest';
import { stepValue } from './useCountUp';

describe('stepValue', () => {
  it('is exact at both ends', () => {
    expect(stepValue(5n, 905n, 0)).toBe(5n);
    expect(stepValue(5n, 905n, 1)).toBe(905n);
    expect(stepValue(5n, 905n, 2)).toBe(905n);
    expect(stepValue(5n, 905n, -1)).toBe(5n);
  });

  it('rises monotonically and eases out, counting down as well as up', () => {
    const up = [0.1, 0.3, 0.6, 0.9].map(t => stepValue(0n, 1000n, t));
    expect(up).toEqual([...up].sort((a, b) => Number(a - b)));
    expect(up[0]!).toBeGreaterThan(100n);
    const down = [0.2, 0.5, 0.8].map(t => stepValue(1000n, 0n, t));
    expect(down).toEqual([...down].sort((a, b) => Number(b - a)));
  });

  it('handles yoctoNEAR sizes without losing the end value', () => {
    const from = 12_345_678_901_234_567_890_123_456n;
    const to = from + 3_000_000_000_000_000_000_000_000n;
    const mid = stepValue(from, to, 0.5);
    expect(mid > from && mid < to).toBe(true);
    expect(stepValue(from, to, 1)).toBe(to);
  });
});
