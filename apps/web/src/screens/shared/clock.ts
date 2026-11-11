import type { Round } from '@/game/types';

/**
 * What the clock says about a round, derived from the chain's own deadlines. The chain keeps a round in
 * `Investigation` until someone advances it, but the contract already rejects plays after the deadline, so the
 * UI must follow the deadline, not only the stored phase.
 */
export type ClockStage = 'plays-open' | 'plays-closed' | 'reveal-open' | 'reveal-ended' | 'none';

export interface RoundClock {
  stage: ClockStage;
  /** The deadline this stage counts down to, epoch ms. Null when there is none. */
  deadlineMs: number | null;
  /** Time left to the deadline, never negative. */
  remainingMs: number;
}

const NONE: RoundClock = { stage: 'none', deadlineMs: null, remainingMs: 0 };

export function roundClock(round: Round | null | undefined, now: number): RoundClock {
  if (!round) return NONE;
  if (round.phase === 'Investigation' && round.investigationEndMs !== null) {
    const remainingMs = Math.max(0, round.investigationEndMs - now);
    return {
      stage: now < round.investigationEndMs ? 'plays-open' : 'plays-closed',
      deadlineMs: round.investigationEndMs,
      remainingMs,
    };
  }
  if (round.phase === 'Reveal' && round.revealDeadlineMs !== null) {
    const remainingMs = Math.max(0, round.revealDeadlineMs - now);
    return {
      stage: now < round.revealDeadlineMs ? 'reveal-open' : 'reveal-ended',
      deadlineMs: round.revealDeadlineMs,
      remainingMs,
    };
  }
  return NONE;
}

/** Plays and new commits are accepted: the Investigation phase and, when known, before its deadline. */
export function playsOpen(round: Round | null | undefined, now: number): boolean {
  if (!round || round.phase !== 'Investigation') return false;
  return round.investigationEndMs === null || now < round.investigationEndMs;
}

/** `6:42`, or `1:59:12` past an hour. Partial seconds round up so the clock never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The one-line clock for headers and strips. Empty when there is no clock. */
export function clockText(clock: RoundClock): string {
  switch (clock.stage) {
    case 'plays-open':
      return `Plays close in ${formatCountdown(clock.remainingMs)}`;
    case 'plays-closed':
      return 'Plays closed';
    case 'reveal-open':
      return `Reveal closes in ${formatCountdown(clock.remainingMs)}`;
    case 'reveal-ended':
      return 'Reveal ended';
    case 'none':
      return '';
  }
}
