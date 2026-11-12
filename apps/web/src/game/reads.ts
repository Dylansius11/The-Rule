import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { toUiError } from '@/chain/errors';
import { getNearBalance } from '@/chain/rpc';
import { discoverRoundHistory } from '@/chain/round-history';
import { active } from '@/config/env';
import * as v from '@/chain/views';
import { isTerminalPhase, payoutTotal, planPayouts } from './payouts';
import type { Mode, Round } from './types';

/**
 * Per-account state (credit, token storage, lock) changes only through this player's own transactions, and every
 * action invalidates all queries when it lands, so it refreshes slowly. Shared round state stays at 4 s while live.
 */
const ACCOUNT_POLL_MS = 10_000;

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
    queryKey: ['round', mode, roundId, active.game],
    queryFn: () => v.getRound(mode, roundId!),
    enabled: roundId != null,
    refetchInterval: q => (live(q.state.data) ? 4000 : false),
  });
}
export function useLatestRound(mode: Mode) {
  return useQuery({
    queryKey: ['latestRound', mode, active.game],
    queryFn: () => v.getRound(mode),
    refetchInterval: q => (live(q.state.data) ? 4000 : 30000),
  });
}
export interface RoundHistory {
  latest: Round | null;
  rounds: Round[];
  loading: boolean;
  error: unknown;
  limited: boolean;
  from: number | null;
  to: number | null;
  retry: () => void;
}

/** Lookup-only ABI: inspect at most 30 IDs ending at the actual latest record, never the next scheduled slot. */
export function useRoundHistory(mode: Mode): RoundHistory {
  const latest = useLatestRound(mode);
  const discovery = useQuery({
    queryKey: ['roundHistory', active.game, mode, latest.data?.roundId, !!latest.data?.rule],
    enabled: latest.isSuccess && latest.data != null,
    queryFn: () => discoverRoundHistory(mode, latest.data ?? null),
  });
  const current = latest.data;
  const rounds = current
    ? [current, ...(discovery.data?.rounds.filter(r => r.roundId !== current.roundId) ?? [])]
    : [];
  return {
    latest: latest.data ?? null,
    rounds,
    loading: latest.isLoading || (latest.data != null && discovery.isLoading),
    error: latest.error ?? discovery.error ?? discovery.data?.failures[0]?.error ?? null,
    limited: discovery.data?.limited ?? false,
    from: discovery.data?.from ?? null,
    to: discovery.data?.to ?? null,
    retry: () => {
      void latest.refetch();
      if (latest.data) void discovery.refetch();
    },
  };
}

export function useLatestRevealedRound() {
  const solo = useRoundHistory(0);
  const team = useRoundHistory(1);
  const candidates = [...solo.rounds, ...team.rounds].filter(r => r.rule);
  candidates.sort((a, b) => (b.sealedAtMs ?? 0) - (a.sealedAtMs ?? 0));
  const error = solo.error ?? team.error;
  return {
    data: candidates[0] ?? null,
    isLoading: solo.loading || team.loading,
    isError: error != null,
    error,
    limited: solo.limited || team.limited,
    refetch: () => {
      solo.retry();
      team.retry();
    },
  };
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
    refetchInterval: ACCOUNT_POLL_MS,
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
    refetchInterval: ACCOUNT_POLL_MS,
  });
export const useSeason = (mode: Mode, season: number) =>
  useQuery({ queryKey: ['season', mode, season], queryFn: () => v.getSeason(mode, season) });

export const useTokenStorage = (account: string | null) =>
  useQuery({
    queryKey: ['tokenStorage', account],
    queryFn: () => v.getTokenStorage(account!),
    enabled: !!account,
    refetchInterval: ACCOUNT_POLL_MS,
  });
export const useTokenStorageMinimum = () =>
  useQuery({ queryKey: ['tokenStorageMinimum'], queryFn: v.getTokenStorageMinimum });
export const useTokenState = (account: string | null) =>
  useQuery({
    queryKey: ['tokenState', account],
    queryFn: () => v.getTokenState(account!),
    enabled: !!account,
    refetchInterval: query => (query.state.data === 'pending' ? 4000 : ACCOUNT_POLL_MS),
  });

/**
 * What this account can collect now: unlock its team once that team's round has ended, and every observed ended
 * round with something owed. Reads only; `useClaimAll` sends it.
 */
export function usePayouts(account: string | null) {
  const player = usePlayer(account);
  const teamId = player.data?.teamId ?? null;
  const team = useTeam(teamId);
  const activeRoundId = team.data?.activeRound ?? null;
  const activeRound = useRound(1, activeRoundId);
  const solo = useRoundHistory(0);
  const teamRounds = useRoundHistory(1);
  const candidates = [
    ...solo.rounds.slice(0, 6).map(r => ({ mode: 0 as Mode, round: r })),
    ...teamRounds.rounds.slice(0, 6).map(r => ({ mode: 1 as Mode, round: r })),
  ].filter(c => isTerminalPhase(c.round.phase));
  const owed = useQueries({
    queries: candidates.map(c => ({
      queryKey: ['claimable', c.mode, c.round.roundId, account],
      queryFn: () => v.getClaimable(c.mode, c.round.roundId, account!),
      enabled: !!account,
    })),
  });
  const loading =
    player.isLoading ||
    team.isLoading ||
    activeRound.isLoading ||
    solo.loading ||
    teamRounds.loading ||
    owed.some(q => q.isLoading);
  const items = planPayouts({
    team:
      team.data != null
        ? {
            teamId: team.data.teamId,
            activeRound: team.data.activeRound,
            activeRoundPhase: activeRound.data?.phase ?? null,
          }
        : null,
    claims: candidates.map((c, i) => ({
      mode: c.mode,
      roundId: c.round.roundId,
      phase: c.round.phase,
      claimable: owed[i]?.data ?? 0n,
    })),
  });
  return { items, total: payoutTotal(items), loading, error: solo.error ?? teamRounds.error ?? null };
}

/** Names of the teams behind a log, sharing the `team` cache with `useTeam`. A deleted team maps to null. */
export function useTeamNames(ids: readonly number[]): Map<number, string | null> {
  const results = useQueries({
    queries: ids.map(id => ({
      queryKey: ['team', id],
      queryFn: () => v.getTeam(id),
      staleTime: 60_000,
    })),
  });
  const signature = ids.map((id, i) => `${id}:${results[i]?.data?.name ?? ''}`).join('|');
  // The signature, not the arrays, is the identity of the names, so the map is stable between polls.
  return useMemo(() => new Map(ids.map((id, i) => [id, results[i]?.data?.name ?? null])), [signature]);
}
