import { describe, expect, it } from 'vitest';
import { nameTiers, TIER_NAMES } from './tiers';

const R = 10n ** 18n;
const live = [
  { amount: 1000n * R, extraAttempts: 25 },
  { amount: 5000n * R, extraAttempts: 50 },
  { amount: 20000n * R, extraAttempts: 100 },
];

describe('nameTiers', () => {
  it('names the three production tiers in amount order', () => {
    expect(nameTiers(live).map(t => t.name)).toEqual([...TIER_NAMES]);
  });
  it('sorts by amount whatever order the contract returns', () => {
    const named = nameTiers([live[2]!, live[0]!, live[1]!]);
    expect(named.map(t => t.extraAttempts)).toEqual([25, 50, 100]);
    expect(named.map(t => t.index)).toEqual([0, 1, 2]);
  });
  it('does not mutate its input', () => {
    const input = [live[1]!, live[0]!];
    nameTiers(input);
    expect(input[0]).toBe(live[1]);
  });
  it('names fewer than three tiers by position', () => {
    expect(nameTiers(live.slice(0, 2)).map(t => t.name)).toEqual(['Ribbon', 'Wax']);
    expect(nameTiers([])).toEqual([]);
  });
  it('labels tiers beyond the known names instead of failing', () => {
    const more = [
      ...live,
      { amount: 50000n * R, extraAttempts: 150 },
      { amount: 90000n * R, extraAttempts: 175 },
    ];
    expect(nameTiers(more).map(t => t.name)).toEqual(['Ribbon', 'Wax', 'Signet', 'Tier 4', 'Tier 5']);
  });
  it('keeps the contract fields', () => {
    expect(nameTiers(live)[1]).toMatchObject({ amount: 5000n * R, extraAttempts: 50, name: 'Wax' });
  });
});
