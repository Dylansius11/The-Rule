import { describe, expect, it } from 'vitest';
import { depositShares, exitShare, showCaptainBadge, teamMinted } from './vault';

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

describe('exitShare', () => {
  const team = {
    vault: 1_908_560_000_000_000_000_000_000n,
    weight: 3n * NEAR,
    deposits: [
      { account: 'a.testnet', weight: 2n * NEAR },
      { account: 'b.testnet', weight: NEAR },
    ],
  };

  it('returns the depositor cut of the vault, rounded down', () => {
    expect(exitShare(team, 'a.testnet')).toBe(1_272_373_333_333_333_333_333_333n);
    expect(exitShare(team, 'b.testnet')).toBe(636_186_666_666_666_666_666_666n);
  });

  it('is zero for a member who put nothing in and for an empty vault weight', () => {
    expect(exitShare(team, 'c.testnet')).toBe(0n);
    expect(exitShare({ ...team, weight: 0n, deposits: [] }, 'a.testnet')).toBe(0n);
  });
});
