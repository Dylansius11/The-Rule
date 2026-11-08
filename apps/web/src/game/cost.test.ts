import { describe, expect, it } from 'vitest';
import {
  bpsPercent,
  feeSplitRows,
  guessCost,
  playCost,
  potSplitRows,
  shareOf,
  splitText,
  stakeFor,
  wrongGuess,
} from './cost';

const NEAR = 10n ** 24n;
// Live game-r2 values (read 2026-11-09).
const params = {
  playFee: NEAR / 100n,
  storagePerPlay: 20_480_000_000_000_000_000_000n,
  stakeBps: [100, 200] as [number, number],
  stakeMin: NEAR / 10n,
  feeSplitBps: [8000, 1500, 500] as [number, number, number],
  solvedSplitBps: [4000, 4000, 1000, 1000] as [number, number, number, number],
  unsolvedSplitBps: [4000, 5000, 1000] as [number, number, number],
};

describe('bpsPercent', () => {
  it('prints whole and fractional percentages', () => {
    expect(bpsPercent(8000)).toBe('80%');
    expect(bpsPercent(100)).toBe('1%');
    expect(bpsPercent(150)).toBe('1.5%');
    expect(bpsPercent(5)).toBe('0.05%');
    expect(bpsPercent(0)).toBe('0%');
  });
});

describe('stakeFor / guessCost', () => {
  it('uses the floor while the pot share is below it', () => {
    expect(stakeFor(5n * NEAR, 100, NEAR / 10n)).toBe(NEAR / 10n);
  });
  it('uses the pot share once it exceeds the floor', () => {
    expect(stakeFor(50n * NEAR, 100, NEAR / 10n)).toBe(NEAR / 2n);
    expect(stakeFor(50n * NEAR, 200, NEAR / 10n)).toBe(NEAR);
  });
  it('returns the floor at exactly the boundary', () => {
    expect(stakeFor(10n * NEAR, 100, NEAR / 10n)).toBe(NEAR / 10n);
  });
  it('adds the storage charge on top of the stake, per mode', () => {
    const solo = guessCost(params, 0, 50n * NEAR);
    expect(solo.stake).toBe(NEAR / 2n);
    expect(solo.total).toBe(NEAR / 2n + params.storagePerPlay);
    expect(solo.bps).toBe(100);
    expect(solo.atFloor).toBe(false);
    expect(solo.potKnown).toBe(true);
    expect(guessCost(params, 1, 50n * NEAR).stake).toBe(NEAR);
  });
  it('falls back to the floor and says so when no pot is known', () => {
    const c = guessCost(params, 0, null);
    expect(c.stake).toBe(NEAR / 10n);
    expect(c.atFloor).toBe(true);
    expect(c.potKnown).toBe(false);
  });
});

describe('playCost', () => {
  it('is the fee plus the storage charge', () => {
    const c = playCost(params);
    expect(c.total).toBe(30_480_000_000_000_000_000_000n);
    expect(c.fee + c.storage).toBe(c.total);
  });
});

describe('splits', () => {
  it('splits one play fee 80 / 15 / 5 without losing yocto', () => {
    const r = feeSplitRows(params);
    expect(r.map(x => x.percent)).toEqual(['80%', '15%', '5%']);
    expect(r.reduce((s, x) => s + (x.amount ?? 0n), 0n)).toBe(params.playFee);
  });
  it('splits a solved pot 40 / 40 / 10 / 10', () => {
    const r = potSplitRows(true, params, 10n * NEAR);
    expect(splitText(r)).toBe('Winner 40%, Contributors 40%, Rollover to the next round 10%, Platform 10%');
    expect(r.map(x => x.amount)).toEqual([4n * NEAR, 4n * NEAR, NEAR, NEAR]);
  });
  it('splits an unsolved pot 40 / 50 / 10 and has no winner row', () => {
    const r = potSplitRows(false, params, 10n * NEAR);
    expect(r.map(x => x.label)).not.toContain('Winner');
    expect(r.map(x => x.amount)).toEqual([4n * NEAR, 5n * NEAR, NEAR]);
  });
  it('gives no amounts when there is no pot', () => {
    expect(potSplitRows(true, params, null).every(x => x.amount === null)).toBe(true);
  });
  it('rounds down like integer maths', () => {
    expect(shareOf(3n, 5000)).toBe(1n);
  });
});

describe('wrongGuess', () => {
  it('returns half and sends the rest to the pot', () => {
    expect(wrongGuess(NEAR, 5000)).toEqual({ back: NEAR / 2n, toPot: NEAR / 2n });
  });
  it('keeps back + toPot equal to the stake on odd amounts', () => {
    const w = wrongGuess(7n, 5000);
    expect(w.back + w.toPot).toBe(7n);
  });
});
