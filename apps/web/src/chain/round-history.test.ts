import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mode, Round } from '@/game/types';
import { getRound } from './views';
import { discoverRoundHistory } from './round-history';

vi.mock('./views', () => ({ getRound: vi.fn() }));

function round(roundId: number, mode: Mode = 0): Round {
  return {
    mode,
    roundId,
    phase: 'Settled',
    demo: false,
    commit: null,
    header: null,
    seed: null,
    pot: 0n,
    allowanceLeft: 0n,
    logLen: 0,
    pendingChecks: 0,
    sealedAtMs: null,
    investigationEndMs: null,
    freezeMs: null,
    revealDeadlineMs: null,
    outcome: null,
    rule: null,
    salt: null,
  };
}

beforeEach(() => vi.resetAllMocks());

describe('discoverRoundHistory', () => {
  it('returns an empty window without reads when there is no latest round', async () => {
    expect(await discoverRoundHistory(0, null)).toEqual({
      rounds: [],
      failures: [],
      from: null,
      to: null,
      limited: false,
    });
    expect(getRound).not.toHaveBeenCalled();
  });

  it('anchors sparse history at latest 12 and omits absent records', async () => {
    vi.mocked(getRound).mockImplementation(async (mode, id) =>
      id === 10 || id === 0 ? round(id, mode) : null,
    );
    const latest = round(12);
    const result = await discoverRoundHistory(0, latest);
    expect(result).toEqual({
      rounds: [latest, round(10), round(0)],
      failures: [],
      from: 0,
      to: 12,
      limited: false,
    });
    expect(vi.mocked(getRound).mock.calls.map(([, id]) => id)).toEqual([
      11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
  });

  it('keeps round zero as a real record without looking for older IDs', async () => {
    const latest = round(0);
    expect(await discoverRoundHistory(0, latest)).toEqual({
      rounds: [latest],
      failures: [],
      from: 0,
      to: 0,
      limited: false,
    });
    expect(getRound).not.toHaveBeenCalled();
  });

  it('bounds a huge round ID to 29 older reads and four concurrent requests', async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(getRound).mockImplementation(async (mode, id) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return round(id!, mode);
    });
    const latestId = 1_000_000_000;
    const result = await discoverRoundHistory(1, round(latestId, 1));
    expect(result.from).toBe(latestId - 29);
    expect(result.to).toBe(latestId);
    expect(result.limited).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.rounds.map(r => r.roundId)).toEqual(Array.from({ length: 30 }, (_, i) => latestId - i));
    expect(getRound).toHaveBeenCalledTimes(29);
    expect(vi.mocked(getRound).mock.calls.every(([mode]) => mode === 1)).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('retains lookup failures separately from absent rounds, including ID zero', async () => {
    const error = new Error('RPC offline');
    vi.mocked(getRound).mockImplementation(async (_mode, id) => {
      if (id === 0) throw error;
      if (id === 2) return round(2);
      return null;
    });
    expect(await discoverRoundHistory(0, round(3))).toEqual({
      rounds: [round(3), round(2)],
      failures: [{ id: 0, error }],
      from: 0,
      to: 3,
      limited: false,
    });
    vi.mocked(getRound).mockResolvedValue(null);
    expect(await discoverRoundHistory(0, round(1))).toEqual({
      rounds: [round(1)],
      failures: [],
      from: 0,
      to: 1,
      limited: false,
    });
  });
});
