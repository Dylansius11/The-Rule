import type { Mode, Round } from '@/game/types';
import { getRound } from './views';

export const HISTORY_LIMIT = 30;

export async function discoverRoundHistory(
  mode: Mode,
  latest: Round | null,
): Promise<{
  rounds: Round[];
  failures: { id: number; error: unknown }[];
  from: number | null;
  to: number | null;
  limited: boolean;
}> {
  if (!latest) return { rounds: [], failures: [], from: null, to: null, limited: false };

  const to = latest.roundId;
  const from = Math.max(0, to - (HISTORY_LIMIT - 1));
  const rounds = [latest];
  const failures: { id: number; error: unknown }[] = [];

  for (let end = to - 1; end >= from; end -= 4) {
    const ids = Array.from({ length: Math.min(4, end - from + 1) }, (_, index) => end - index);
    const results = await Promise.allSettled(ids.map(id => getRound(mode, id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') failures.push({ id: ids[index]!, error: result.reason });
      else if (result.value) rounds.push(result.value);
    });
  }

  rounds.sort((a, b) => b.roundId - a.roundId);
  return { rounds, failures, from, to, limited: from > 0 };
}
