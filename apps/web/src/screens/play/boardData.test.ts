import { describe, expect, it } from 'vitest';
import type { Commit } from '@/game/types';
import { boardRows, boardSummary } from './boardData';

const commit = (over: Partial<Commit>): Commit => ({
  commitSeq: 0,
  seq: 1,
  entityTag: 0,
  entityId: 1,
  actor: 'alice.testnet',
  hash: 'aa',
  stake: 100_000_000_000_000_000_000_000n,
  block: 10,
  status: 'Committed',
  ...over,
});

describe('boardSummary', () => {
  it('counts every status and the total', () => {
    const s = boardSummary([
      commit({ commitSeq: 0 }),
      commit({ commitSeq: 1, status: 'Checking' }),
      commit({ commitSeq: 2, status: 'Wrong' }),
      commit({ commitSeq: 3, status: 'Wrong' }),
      commit({ commitSeq: 4, status: 'Correct' }),
      commit({ commitSeq: 5, status: 'Refunded' }),
      commit({ commitSeq: 6, status: 'Unrevealed' }),
    ]);
    expect(s).toEqual({ total: 7, sealed: 1, checking: 1, correct: 1, wrong: 2, refunded: 1, unrevealed: 1 });
  });
  it('is all zero for an empty round', () => {
    expect(boardSummary([]).total).toBe(0);
  });
});

describe('boardRows', () => {
  it('orders by commit order, because the earliest correct commit wins, not the earliest reveal', () => {
    const rows = boardRows(
      [
        commit({ commitSeq: 2, seq: 30 }),
        commit({ commitSeq: 0, seq: 10 }),
        commit({ commitSeq: 1, seq: 20 }),
      ],
      null,
    );
    expect(rows.map(r => r.seq)).toEqual([10, 20, 30]);
    expect(rows.map(r => r.place)).toEqual([1, 2, 3]);
  });

  it('marks the player’s own commits and names a team entity', () => {
    const rows = boardRows(
      [
        commit({ commitSeq: 0, seq: 1, actor: 'alice.testnet' }),
        commit({ commitSeq: 1, seq: 2, actor: 'bob.testnet', entityTag: 1, entityId: 7 }),
      ],
      'alice.testnet',
    );
    expect(rows[0]).toMatchObject({ mine: true, who: 'alice.testnet' });
    expect(rows[1]).toMatchObject({ mine: false, who: 'bob.testnet', team: 7 });
  });

  it('only the earliest correct commit is marked as the leader', () => {
    const rows = boardRows(
      [
        commit({ commitSeq: 0, seq: 5, status: 'Correct' }),
        commit({ commitSeq: 1, seq: 9, status: 'Correct' }),
        commit({ commitSeq: 2, seq: 12, status: 'Wrong' }),
      ],
      null,
    );
    expect(rows.map(r => r.leads)).toEqual([true, false, false]);
  });
});
