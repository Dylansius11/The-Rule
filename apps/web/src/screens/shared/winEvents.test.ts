import { beforeEach, describe, expect, it } from 'vitest';
import type { Commit, Round } from '@/game/types';
import { correctEvent, loadSeen, nextUnseen, rememberSeen, wonEvent } from './winEvents';

const round = (over: Partial<Round> = {}): Round => ({
  mode: 0,
  roundId: 7,
  phase: 'Settled',
  demo: false,
  commit: null,
  header: null,
  seed: null,
  pot: 1_000n,
  allowanceLeft: 0n,
  logLen: 0,
  pendingChecks: 0,
  sealedAtMs: null,
  investigationEndMs: null,
  freezeMs: null,
  revealDeadlineMs: null,
  outcome: { kind: 'Solved', account: 'me.testnet', entityTag: 0, entityId: 1 },
  rule: null,
  salt: null,
  ...over,
});
const commit = (over: Partial<Commit> = {}): Commit => ({
  commitSeq: 3,
  seq: 3,
  entityTag: 0,
  entityId: 1,
  actor: 'me.testnet',
  hash: 'ab',
  stake: 5n,
  block: 1,
  status: 'Correct',
  ...over,
});

describe('correctEvent', () => {
  it('finds the earliest own Correct commit and ignores others and other statuses', () => {
    const list = [
      commit({ commitSeq: 9 }),
      commit({ commitSeq: 4 }),
      commit({ commitSeq: 1, actor: 'you.testnet' }),
      commit({ commitSeq: 2, status: 'Wrong' }),
    ];
    expect(correctEvent(0, round(), list, 'me.testnet')?.id).toBe('correct:0:7:4');
  });

  it('is null without a wallet, a round, commits or a Correct commit of your own', () => {
    expect(correctEvent(0, round(), [commit()], null)).toBeNull();
    expect(correctEvent(0, null, [commit()], 'me.testnet')).toBeNull();
    expect(correctEvent(0, round(), undefined, 'me.testnet')).toBeNull();
    expect(correctEvent(0, round(), [commit({ status: 'Checking' })], 'me.testnet')).toBeNull();
  });
});

describe('wonEvent', () => {
  it('fires for the winning account', () => {
    expect(wonEvent(0, round(), 'me.testnet', null)).toMatchObject({
      id: 'won:0:7',
      kind: 'won',
      team: false,
    });
  });

  it('fires for a member of the winning team', () => {
    const won = round({
      outcome: { kind: 'Solved', account: 'mate.testnet', entityTag: 1, entityId: 12 },
    });
    expect(wonEvent(1, won, 'me.testnet', 12)).toMatchObject({ kind: 'won', team: true });
    expect(wonEvent(1, won, 'me.testnet', 13)).toBeNull();
    expect(wonEvent(1, won, 'me.testnet', null)).toBeNull();
  });

  it('needs a Settled, Solved round', () => {
    expect(wonEvent(0, round({ phase: 'Reveal' }), 'me.testnet', null)).toBeNull();
    expect(wonEvent(0, round({ outcome: { kind: 'Unsolved' } }), 'me.testnet', null)).toBeNull();
    expect(wonEvent(0, round(), 'someone.testnet', null)).toBeNull();
  });
});

describe('nextUnseen', () => {
  const correct = correctEvent(0, round(), [commit()], 'me.testnet');
  const won = wonEvent(0, round(), 'me.testnet', null);

  it('skips what was shown and prefers a round win', () => {
    expect(nextUnseen([correct, won], new Set())?.kind).toBe('won');
    expect(nextUnseen([correct, won], new Set(['won:0:7']))?.kind).toBe('correct');
    expect(nextUnseen([correct, won], new Set(['won:0:7', 'correct:0:7:3']))).toBeNull();
    expect(nextUnseen([null, null], new Set())).toBeNull();
  });
});

describe('seen ids', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
    } as Storage;
  });

  it('remembers per scope and survives garbage', () => {
    expect(loadSeen('a').size).toBe(0);
    rememberSeen('a', 'won:0:7');
    rememberSeen('a', 'correct:0:7:3');
    expect([...loadSeen('a')]).toEqual(['won:0:7', 'correct:0:7:3']);
    expect(loadSeen('b').size).toBe(0);
    localStorage.setItem('the-rule:wins-seen:c', '{oops');
    expect(loadSeen('c').size).toBe(0);
  });
});
