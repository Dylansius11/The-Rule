import { describe, expect, it } from 'vitest';
import { lockTarget } from './lock-target';
import type { Round } from './types';

describe('contract lock target', () => {
  it('selects next slot before the first round and during/after an investigation', () => {
    expect(lockTarget(null, 0)).toBe(0);
    expect(lockTarget(undefined, undefined)).toBeNull();
    for (const phase of ['Investigation', 'Reveal', 'Opening', 'Settled', 'Cancelled', 'Void'] as const) {
      const round = { roundId: 4, phase } as Round;
      expect(lockTarget(round, 5)).toBe(5);
    }
  });
  it('targets the current Sealing round, not the next slot', () => {
    const round = { roundId: 4, phase: 'Sealing' } as Round;
    expect(lockTarget(round, 5)).toBe(4);
  });
});
