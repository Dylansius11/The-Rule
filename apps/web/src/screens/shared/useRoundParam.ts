import { useSearchParams } from 'react-router';
import { useLatestRevealedRound, useLatestRound, useNextSlot } from '@/game';
import type { Mode } from '@/game/types';

/**
 * Which round a page shows: `?mode=0&round=3` wins, else the newest round, or the newest revealed round when
 * `prefer` is "revealed". Also lists every round id that exists so the picker never offers a round that does not.
 */
export function useRoundParam(prefer: 'latest' | 'revealed') {
  const [params, setParams] = useSearchParams();
  const rawMode = params.get('mode');
  const rawRound = params.get('round');
  const explicitMode: Mode | null = rawMode === '0' ? 0 : rawMode === '1' ? 1 : null;
  const revealed = useLatestRevealedRound();
  const fallbackMode: Mode =
    prefer === 'revealed' && revealed.data ? revealed.data.mode : (explicitMode ?? 0);
  const mode: Mode = explicitMode ?? fallbackMode;
  const latest = useLatestRound(mode);
  const slot = useNextSlot(mode);

  const explicitRound = rawRound !== null && /^\d+$/.test(rawRound) ? Number(rawRound) : null;
  const defaultRound =
    prefer === 'revealed' && revealed.data?.mode === mode
      ? revealed.data.roundId
      : (latest.data?.roundId ?? null);
  const roundId = explicitRound ?? defaultRound;
  const count = slot.data?.roundId ?? (latest.data ? latest.data.roundId + 1 : 0);

  const set = (m: Mode, r: number | null) => {
    const next = new URLSearchParams(params);
    next.set('mode', String(m));
    if (r === null) next.delete('round');
    else next.set('round', String(r));
    setParams(next, { replace: true });
  };
  return {
    mode,
    roundId,
    rounds: Array.from({ length: Math.max(0, count) }, (_, i) => i).reverse(),
    setMode: (m: Mode) => set(m, null),
    setRound: (r: number) => set(mode, r),
    loading: latest.isLoading || (prefer === 'revealed' && revealed.isLoading),
    revealed,
  };
}
