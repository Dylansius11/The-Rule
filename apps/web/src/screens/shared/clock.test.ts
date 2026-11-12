import { describe, expect, it } from 'vitest';
import type { Round } from '@/game/types';
import { clockText, formatCountdown, playsOpen, roundClock } from './clock';

const round = (over: Partial<Round>): Round =>
  ({
    mode: 0,
    roundId: 1,
    phase: 'Investigation',
    sealedAtMs: 1_000_000,
    investigationEndMs: 1_600_000,
    freezeMs: null,
    revealDeadlineMs: null,
    ...over,
  }) as Round;

describe('formatCountdown', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(9_000)).toBe('0:09');
    expect(formatCountdown(402_000)).toBe('6:42');
  });
  it('adds hours past one hour and rounds partial seconds up', () => {
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(7_151_001)).toBe('1:59:12');
  });
  it('never shows a negative time', () => {
    expect(formatCountdown(-5_000)).toBe('0:00');
  });
});

describe('roundClock', () => {
  it('counts down plays while the round is open', () => {
    const clock = roundClock(round({}), 1_198_000);
    expect(clock.stage).toBe('plays-open');
    expect(clock.remainingMs).toBe(402_000);
    expect(clock.deadlineMs).toBe(1_600_000);
    expect(clockText(clock)).toBe('Plays close in 6:42');
  });

  it('says plays are closed the moment the deadline passes, even if the chain still says Investigation', () => {
    const exactly = roundClock(round({}), 1_600_000);
    expect(exactly.stage).toBe('plays-closed');
    expect(exactly.remainingMs).toBe(0);
    expect(clockText(exactly)).toBe('Plays closed');
    expect(roundClock(round({}), 1_599_999).stage).toBe('plays-open');
  });

  it('counts the reveal window and then reports it ended', () => {
    const reveal = round({ phase: 'Reveal', freezeMs: 1_300_000, revealDeadlineMs: 1_420_000 });
    expect(roundClock(reveal, 1_400_000).stage).toBe('reveal-open');
    expect(clockText(roundClock(reveal, 1_400_000))).toBe('Reveal closes in 0:20');
    expect(roundClock(reveal, 1_420_000).stage).toBe('reveal-ended');
    expect(clockText(roundClock(reveal, 1_500_000))).toBe('Reveal ended');
  });

  it('has no clock without a deadline or once the round is past the reveal', () => {
    expect(roundClock(round({ investigationEndMs: null }), 5).stage).toBe('none');
    expect(roundClock(round({ phase: 'Reveal', revealDeadlineMs: null }), 5).stage).toBe('none');
    for (const phase of ['Scheduled', 'Sealing', 'Opening', 'Settled', 'Cancelled', 'Void'] as const) {
      expect(roundClock(round({ phase }), 5).stage).toBe('none');
    }
  });
});

describe('playsOpen', () => {
  it('requires both the Investigation phase and time left', () => {
    expect(playsOpen(round({}), 1_000_000)).toBe(true);
    expect(playsOpen(round({}), 1_600_000)).toBe(false);
    expect(playsOpen(round({ phase: 'Reveal' }), 1_000_000)).toBe(false);
    expect(playsOpen(null, 1_000_000)).toBe(false);
  });
  it('trusts the chain phase when no deadline is known', () => {
    expect(playsOpen(round({ investigationEndMs: null }), 9_999_999_999)).toBe(true);
  });
});
