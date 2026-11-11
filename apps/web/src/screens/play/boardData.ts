import type { Commit } from '@/game/types';

export interface BoardSummary {
  total: number;
  sealed: number;
  checking: number;
  correct: number;
  wrong: number;
  refunded: number;
  unrevealed: number;
}

export function boardSummary(commits: readonly Commit[]): BoardSummary {
  const count = (status: Commit['status']) => commits.filter(c => c.status === status).length;
  return {
    total: commits.length,
    sealed: count('Committed'),
    checking: count('Checking'),
    correct: count('Correct'),
    wrong: count('Wrong'),
    refunded: count('Refunded'),
    unrevealed: count('Unrevealed'),
  };
}

export interface BoardRow {
  commitSeq: number;
  /** The commit's place in the contract's order. The earliest correct commit wins, not the earliest reveal. */
  seq: number;
  /** 1-based place in that order. */
  place: number;
  who: string;
  /** The team id when the commit belongs to a team, otherwise null. */
  team: number | null;
  stake: bigint;
  status: Commit['status'];
  mine: boolean;
  /** The earliest Correct commit: the one that wins if the round settles now. */
  leads: boolean;
  /** The sealed commitment. The guess behind it stays hidden until its owner reveals it. */
  hash: string;
}

/** Public commit records in commit order. The guess itself is a hash until its owner reveals it. */
export function boardRows(commits: readonly Commit[], me: string | null): BoardRow[] {
  const ordered = [...commits].sort((a, b) => a.seq - b.seq);
  const leader = ordered.find(c => c.status === 'Correct')?.commitSeq ?? null;
  return ordered.map((c, index) => ({
    commitSeq: c.commitSeq,
    seq: c.seq,
    place: index + 1,
    who: c.actor,
    hash: c.hash,
    team: c.entityTag === 1 ? c.entityId : null,
    stake: c.stake,
    status: c.status,
    mine: me !== null && c.actor === me,
    leads: leader === c.commitSeq,
  }));
}

export const STATUS_WORDS: Record<Commit['status'], string> = {
  Committed: 'Sealed',
  Checking: 'Being checked',
  Correct: 'Correct',
  Wrong: 'Wrong',
  Refunded: 'Refunded',
  Unrevealed: 'Never revealed',
};
