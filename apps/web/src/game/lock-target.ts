import type { Round } from './types';

/** HEAD accepts only the current Sealing round, otherwise the next slot (lock.rs). */
export function lockTarget(round: Round | null | undefined, nextRoundId: number | undefined) {
  return round?.phase === 'Sealing' ? round.roundId : (nextRoundId ?? null);
}
