import { useQuery } from '@tanstack/react-query';
import { toUiError } from '@/chain/errors';
import { getNearBalance } from '@/chain/rpc';
import * as v from '@/chain/views';
import type { Mode, Round } from './types';

const live = (round: Round | null | undefined) =>
  !!round && !['Settled', 'Cancelled', 'Void'].includes(round.phase);
export const useParams = () => useQuery({ queryKey: ['params'], queryFn: v.getParams });
export const useWords = () => useQuery({ queryKey: ['words'], queryFn: v.getWords, staleTime: Infinity });
export const useNextSlot = (mode: Mode) =>
  useQuery({
    queryKey: ['nextSlot', mode],
    queryFn: async () => {
      const slot = await v.getNextSlot(mode);
      return { roundId: slot.round_id, slotMs: Math.floor(Number(slot.slot_ns) / 1_000_000) };
    },
    refetchInterval: 30000,
  });
export function useRound(mode: Mode, roundId: number | null | undefined) {
  return useQuery({
    queryKey: ['round', mode, roundId],
    queryFn: () => v.getRound(mode, roundId!),
    enabled: roundId != null,
    refetchInterval: q => (live(q.state.data) ? 4000 : false),
  });
}
export function useLatestRound(mode: Mode) {
  return useQuery({
    queryKey: ['latestRound', mode],
    queryFn: async () => {
      const active = (await v.getActiveRounds())
        .filter(r => r.mode === mode)
        .sort((a, b) => b.roundId - a.roundId);
      if (active.length) return active[0];
      const slot = await v.getNextSlot(mode);
      return slot.round_id ? v.getRound(mode, slot.round_id - 1) : v.getRound(mode);
    },
    refetchInterval: q => (live(q.state.data) ? 4000 : 30000),
  });
}
export function useLatestRevealedRound() {
  return useQuery({
    queryKey: ['latestRevealed'],
    queryFn: async () => {
      for (const mode of [0, 1] as const) {
        const slot = await v.getNextSlot(mode);
        for (let id = slot.round_id - 1; id >= 0; id--) {
          const round = await v.getRound(mode, id);
          if (round?.rule) return round;
        }
      }
      return null;
    },
  });
}
export function useLog(mode: Mode, roundId: number | null | undefined, options: { follow?: boolean } = {}) {
  const query = useQuery({
    queryKey: ['log', mode, roundId],
    enabled: roundId != null,
    queryFn: async () => {
      const [round, words] = await Promise.all([v.getRound(mode, roundId!), v.getWords()]);
      const total = round?.logLen ?? 0;
      const rows = [];
      for (let from = 0; from < total; from += 200)
        rows.push(...(await v.getLog(mode, roundId!, from, Math.min(200, total - from), words)));
      return { rows, total };
    },
    refetchInterval: options.follow ? 4000 : false,
  });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  return {
    rows,
    total,
    loaded: rows.length,
    complete: !!query.data && rows.length === total,
    status:
      roundId == null
        ? ('idle' as const)
        : query.isError
          ? ('error' as const)
          : query.data
            ? ('ready' as const)
            : ('loading' as const),
    error: query.error ? toUiError(query.error) : null,
    retry: () => {
      if (roundId != null) void query.refetch();
    },
  };
}
export const useCommits = (mode: Mode, roundId: number | null | undefined) =>
  useQuery({
    queryKey: ['commits', mode, roundId],
    queryFn: () => v.getCommits(mode, roundId!),
    enabled: roundId != null,
    refetchInterval: 4000,
  });
export const usePlayer = (account: string | null) =>
  useQuery({
    queryKey: ['player', account],
    queryFn: () => v.getPlayer(account!),
    enabled: !!account,
    refetchInterval: 4000,
  });
export function useEntity(mode: Mode, roundId: number | null | undefined, account: string | null) {
  return useQuery({
    queryKey: ['entity', mode, roundId, account],
    queryFn: async () => v.getEntity(mode, roundId!, account!, await v.getWords()),
    enabled: roundId != null && !!account,
    refetchInterval: 4000,
  });
}
export const useRuleBalance = (account: string | null) =>
  useQuery({
    queryKey: ['balance', account],
    queryFn: () => v.getRuleBalance(account!),
    enabled: !!account,
    refetchInterval: 10000,
  });
export function useNearBalance(account: string | null) {
  return useQuery({
    queryKey: ['nearBalance', account],
    queryFn: () => getNearBalance(account!),
    enabled: !!account,
    refetchInterval: 15_000,
  });
}
export function useTokenOperation(requestId: number | null) {
  return useQuery({
    queryKey: ['tokenOperation', requestId],
    queryFn: () => v.getTokenOperation(requestId!),
    enabled: requestId != null,
    refetchInterval: 15_000,
  });
}
export function useTokenOutcome(operationId: number | null) {
  return useQuery({
    queryKey: ['tokenOutcome', operationId],
    queryFn: () => v.getTokenOutcome(operationId!),
    enabled: operationId != null,
    refetchInterval: 15_000,
  });
}
export const useClaimable = (mode: Mode, roundId: number | null | undefined, account: string | null) =>
  useQuery({
    queryKey: ['claimable', mode, roundId, account],
    queryFn: () => v.getClaimable(mode, roundId!, account!),
    enabled: roundId != null && !!account,
  });
export const useTeam = (teamId: number | null | undefined) =>
  useQuery({
    queryKey: ['team', teamId],
    queryFn: () => v.getTeam(teamId!),
    enabled: teamId != null,
    refetchInterval: 4000,
  });
export const useLock = (mode: Mode, roundId: number | null | undefined, account: string | null) =>
  useQuery({
    queryKey: ['lock', mode, roundId, account],
    queryFn: () => v.getLock(mode, roundId!, account!),
    enabled: roundId != null && !!account,
    refetchInterval: 4000,
  });
export const useSeason = (mode: Mode, season: number) =>
  useQuery({ queryKey: ['season', mode, season], queryFn: () => v.getSeason(mode, season) });

export const useTokenStorage = (account: string | null) =>
  useQuery({
    queryKey: ['tokenStorage', account],
    queryFn: () => v.getTokenStorage(account!),
    enabled: !!account,
    refetchInterval: 4000,
  });
export const useTokenStorageMinimum = () =>
  useQuery({ queryKey: ['tokenStorageMinimum'], queryFn: v.getTokenStorageMinimum });
export const useTokenState = (account: string | null) =>
  useQuery({
    queryKey: ['tokenState', account],
    queryFn: () => v.getTokenState(account!),
    enabled: !!account,
    refetchInterval: 4000,
  });
