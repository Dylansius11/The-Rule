import { describe, expect, it } from 'vitest';
import { payoutTotal, planPayouts } from './payouts';

const team = (activeRound: number | null, activeRoundPhase: string | null) => ({
  teamId: 4,
  activeRound,
  activeRoundPhase,
});

describe('planPayouts', () => {
  it('unlocks a team whose round has ended before anything else', () => {
    const items = planPayouts({
      team: team(340, 'Settled'),
      claims: [{ mode: 0, roundId: 339, phase: 'Settled', claimable: 5n }],
    });
    expect(items.map(i => i.kind)).toEqual(['unlock', 'claim']);
    expect(items[0]).toEqual({ kind: 'unlock', teamId: 4, roundId: 340 });
  });

  it('leaves a team alone while its round is still running or it is not locked', () => {
    expect(planPayouts({ team: team(341, 'Reveal'), claims: [] })).toEqual([]);
    expect(planPayouts({ team: team(null, null), claims: [] })).toEqual([]);
  });

  it('skips rounds that have not ended and claims worth nothing', () => {
    const items = planPayouts({
      team: null,
      claims: [
        { mode: 0, roundId: 5, phase: 'Reveal', claimable: 9n },
        { mode: 0, roundId: 4, phase: 'Settled', claimable: 0n },
      ],
    });
    expect(items).toEqual([]);
  });

  it('claims Team rounds with the current team id and skips them without a team', () => {
    const claims = [{ mode: 1 as const, roundId: 6, phase: 'Settled', claimable: 7n }];
    expect(planPayouts({ team: team(null, null), claims })).toEqual([
      { kind: 'claim', mode: 1, roundId: 6, amount: 7n, teamId: 4 },
    ]);
    expect(planPayouts({ team: null, claims })).toEqual([]);
  });

  it('orders claims newest round first and totals only claims', () => {
    const items = planPayouts({
      team: team(8, 'Void'),
      claims: [
        { mode: 0, roundId: 7, phase: 'Settled', claimable: 2n },
        { mode: 0, roundId: 9, phase: 'Cancelled', claimable: 3n },
      ],
    });
    expect(items.map(i => (i.kind === 'claim' ? i.roundId : 'unlock'))).toEqual(['unlock', 9, 7]);
    expect(payoutTotal(items)).toBe(5n);
  });
});
