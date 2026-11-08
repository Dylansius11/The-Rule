import type { Mode, Phase, Round } from '@/game/types';

export const modeName = (mode: Mode) => (mode === 0 ? 'Solo' : 'Team');

/** The round can still change: not Settled, Cancelled or Void. */
export const isActive = (round: Round | null | undefined): boolean =>
  !!round && !['Settled', 'Cancelled', 'Void'].includes(round.phase);

/** Plays and commits are accepted. */
export const isPlayable = (round: Round | null | undefined): boolean =>
  !!round && round.phase === 'Investigation';

const PHASE: Record<Phase, string> = {
  Scheduled: 'Scheduled',
  Sealing: 'Sealing',
  Investigation: 'Plays open',
  Reveal: 'Reveal window',
  Opening: 'Opening',
  Settled: 'Settled',
  Cancelled: 'Cancelled',
  Void: 'Void',
};
export const phaseLabel = (phase: Phase) => PHASE[phase];

export function outcomeLabel(round: Round): string {
  const o = round.outcome;
  if (!o) return round.phase === 'Settled' ? 'Settled' : phaseLabel(round.phase);
  switch (o.kind) {
    case 'Solved':
      return 'Solved';
    case 'Unsolved':
      return 'Unsolved';
    case 'Cancelled':
      return 'Cancelled';
    case 'Void':
      return 'Void';
  }
}

/** Three digits always: digit atoms count leading zeros. */
export const pad3 = (n: number) => String(n).padStart(3, '0');
