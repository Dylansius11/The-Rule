import { useSearchParams } from 'react-router';
import { useRound, useRoundHistory } from '@/game';
import type { Mode } from '@/game/types';

/**
 * Explicit historical URLs win. Otherwise wait for the bounded discovery before choosing a revealed round, so
 * asynchronous history cannot first select the latest sealed round and then jump to an older open round.
 */
export function useRoundSelection(mode: Mode, prefer: 'latest' | 'revealed') {
  const [params, setParams] = useSearchParams();
  const raw = params.get('round');
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  const explicit = Number.isInteger(parsed) && parsed >= 0 && parsed <= 4_294_967_295 ? parsed : null;
  const history = useRoundHistory(mode);
  const requested = useRound(mode, explicit);
  const revealed = history.rounds.find(r => r.rule) ?? null;
  const fallback =
    prefer === 'revealed' && history.loading
      ? null
      : ((prefer === 'revealed' ? revealed?.roundId : null) ?? history.latest?.roundId ?? null);
  const roundId = explicit ?? fallback;
  const rounds = history.rounds.map(r => r.roundId);
  if (requested.data && !rounds.includes(requested.data.roundId)) {
    rounds.push(requested.data.roundId);
    rounds.sort((a, b) => b - a);
  }

  return {
    roundId,
    rounds,
    setRound: (id: number) => {
      const next = new URLSearchParams(params);
      next.set('round', String(id));
      setParams(next, { replace: true });
    },
    loading: explicit === null && history.loading,
    revealed,
    history,
  };
}
