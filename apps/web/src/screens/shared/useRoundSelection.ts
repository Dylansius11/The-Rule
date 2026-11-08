import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { getRound } from '@/chain/views';
import { useLatestRound, useNextSlot } from '@/game';
import type { Mode } from '@/game/types';

/** The newest round of this mode whose rule is public, or null when none has opened yet. */
function useLatestRevealed(mode: Mode, enabled: boolean) {
  const slot = useNextSlot(mode);
  const count = slot.data?.roundId;
  return useQuery({
    queryKey: ['latestRevealedIn', mode, count],
    enabled: enabled && count !== undefined,
    queryFn: async () => {
      for (let id = (count ?? 0) - 1; id >= 0; id--) {
        const round = await getRound(mode, id);
        if (round?.rule) return round;
      }
      return null;
    },
  });
}

/**
 * Which round of this mode a tab shows: `?round=3` wins, else the newest round, or (Verify) the newest round whose
 * rule is already public. Also lists every round id that exists so a picker never offers one that does not.
 */
export function useRoundSelection(mode: Mode, prefer: 'latest' | 'revealed') {
  const [params, setParams] = useSearchParams();
  const raw = params.get('round');
  const explicit = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  const latest = useLatestRound(mode);
  const slot = useNextSlot(mode);
  const revealed = useLatestRevealed(mode, prefer === 'revealed');

  const fallback =
    prefer === 'revealed'
      ? (revealed.data?.roundId ?? latest.data?.roundId ?? null)
      : (latest.data?.roundId ?? null);
  const roundId = explicit ?? fallback;
  const count = slot.data?.roundId ?? (latest.data ? latest.data.roundId + 1 : 0);

  return {
    roundId,
    rounds: Array.from({ length: Math.max(0, count) }, (_, i) => i).reverse(),
    setRound: (id: number) => {
      const next = new URLSearchParams(params);
      next.set('round', String(id));
      setParams(next, { replace: true });
    },
    loading: latest.isLoading || (prefer === 'revealed' && revealed.isLoading),
    /** The newest revealed round of this mode, once known. */
    revealed: revealed.data ?? null,
  };
}
