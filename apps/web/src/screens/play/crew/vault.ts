import type { LogRow, Team } from '@/game/types';

export interface DepositShare {
  account: string;
  amount: bigint;
  /** Whole percent of all deposits, rounded down; shares can sum to 99. */
  percent: number;
}

/** Each depositor's amount and their share of the vault's deposits, for display only. */
export function depositShares(team: Pick<Team, 'deposits' | 'weight'>): DepositShare[] {
  return team.deposits.map(d => ({
    account: d.account,
    amount: d.weight,
    percent: team.weight === 0n ? 0 : Number((d.weight * 100n) / team.weight),
  }));
}

/** A captain badge only tells something when there is a crew to captain. */
export const showCaptainBadge = (team: Pick<Team, 'members'>): boolean => team.members.length > 1;

/** RULE this team's stamps minted in one round, and how much of it landed on `account`. */
export function teamMinted(
  rows: readonly Pick<LogRow, 'entityTag' | 'entityId' | 'account' | 'minted'>[],
  teamId: number,
  account: string,
): { total: bigint; mine: bigint } {
  let total = 0n;
  let mine = 0n;
  for (const row of rows) {
    if (row.entityTag !== 1 || row.entityId !== teamId) continue;
    total += row.minted;
    if (row.account === account) mine += row.minted;
  }
  return { total, mine };
}
