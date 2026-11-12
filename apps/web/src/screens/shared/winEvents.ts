import type { Commit, Mode, Round } from '@/game/types';

/**
 * A result worth a celebration, found in data the app already polls:
 * - `correct`: one of the player's own commits was judged Correct.
 * - `won`: a Settled round whose winner is the player, or the player's team.
 * Each has a stable id so the modal opens once per commit or round.
 */
export type WinEvent =
  | { id: string; kind: 'correct'; mode: Mode; round: Round; commit: Commit }
  | { id: string; kind: 'won'; mode: Mode; round: Round; team: boolean };

/** The player's own commit that was judged Correct in this round, the earliest first. Null when there is none. */
export function correctEvent(
  mode: Mode,
  round: Round | null,
  commits: readonly Commit[] | undefined,
  account: string | null,
): WinEvent | null {
  if (!round || !commits || account === null) return null;
  const mine = commits
    .filter(c => c.actor === account && c.status === 'Correct')
    .sort((a, b) => a.commitSeq - b.commitSeq)[0];
  return mine
    ? { id: `correct:${mode}:${round.roundId}:${mine.commitSeq}`, kind: 'correct', mode, round, commit: mine }
    : null;
}

/** A Settled round the player, or the player's team, won. */
export function wonEvent(
  mode: Mode,
  round: Round | null,
  account: string | null,
  teamId: number | null,
): WinEvent | null {
  if (!round || account === null || round.phase !== 'Settled' || round.outcome?.kind !== 'Solved')
    return null;
  const outcome = round.outcome;
  const mine = outcome.account === account;
  const team = outcome.entityTag === 1 && teamId !== null && outcome.entityId === teamId;
  return mine || team
    ? { id: `won:${mode}:${round.roundId}`, kind: 'won', mode, round, team: team && !mine }
    : null;
}

/** The first event whose id has not been shown yet; a round win comes before a correct guess. */
export function nextUnseen(events: readonly (WinEvent | null)[], seen: ReadonlySet<string>): WinEvent | null {
  const fresh = events.filter((e): e is WinEvent => e !== null && !seen.has(e.id));
  return fresh.find(e => e.kind === 'won') ?? fresh[0] ?? null;
}

const KEY = 'the-rule:wins-seen';
const KEEP = 200;

/** Ids already celebrated for this deployment and account. Storage can be blocked: then nothing is remembered. */
export function loadSeen(scope: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`${KEY}:${scope}`) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberSeen(scope: string, id: string): void {
  try {
    const next = [...loadSeen(scope), id].slice(-KEEP);
    localStorage.setItem(`${KEY}:${scope}`, JSON.stringify(next));
  } catch {
    /* Storage is optional: the modal may show again after a reload. */
  }
}
