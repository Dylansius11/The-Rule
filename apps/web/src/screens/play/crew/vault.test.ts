import { describe, expect, it } from 'vitest';
import { depositShares, showCaptainBadge, teamMinted } from './vault';

const NEAR = 10n ** 24n;

describe('depositShares', () => {
  it('splits by deposit and never exceeds 100 in total', () => {
    const shares = depositShares({
      weight: 3n * NEAR,
      deposits: [
        { account: 'a.testnet', weight: 2n * NEAR },
        { account: 'b.testnet', weight: NEAR },
      ],
    });
    expect(shares.map(s => s.percent)).toEqual([66, 33]);
  });

  it('shows 0 instead of dividing by an empty vault', () => {
    expect(depositShares({ weight: 0n, deposits: [{ account: 'a.testnet', weight: 0n }] })[0]!.percent).toBe(
      0,
    );
  });
});

describe('showCaptainBadge', () => {
  it('only labels a captain when there is a crew', () => {
    expect(showCaptainBadge({ members: ['a.testnet'] })).toBe(false);
    expect(showCaptainBadge({ members: ['a.testnet', 'b.testnet'] })).toBe(true);
  });
});

describe('teamMinted', () => {
  const row = (entityTag: number, entityId: number, account: string, minted: bigint) => ({
    entityTag,
    entityId,
    account,
    minted,
  });

  it('counts only this team and splits out what landed on one account', () => {
    const rows = [
      row(1, 7, 'me.testnet', 50n),
      row(1, 7, 'friend.testnet', 25n),
      row(1, 8, 'me.testnet', 99n),
      row(0, 7, 'me.testnet', 99n),
    ];
    expect(teamMinted(rows, 7, 'me.testnet')).toEqual({ total: 75n, mine: 50n });
  });

  it('is zero without rows', () => {
    expect(teamMinted([], 1, 'me.testnet')).toEqual({ total: 0n, mine: 0n });
  });
});
