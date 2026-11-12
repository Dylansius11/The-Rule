import type { LogRow } from '@/game/types';

type TeamRow = Pick<LogRow, 'entityTag' | 'entityId'>;

/** Distinct team ids behind a round's rows, in first-seen order. Solo rows have none. */
export function teamIdsIn(rows: readonly TeamRow[]): number[] {
  const ids: number[] = [];
  for (const row of rows) if (row.entityTag === 1 && !ids.includes(row.entityId)) ids.push(row.entityId);
  return ids;
}

/** "name" when the team still exists, else just its number: a deleted team keeps its history. */
export const teamLabel = (id: number, name: string | null | undefined): string =>
  name ? `${name} #${id}` : `Team #${id}`;

export type TeamFilter = 'all' | 'mine';

/** `mine` keeps only the signed-in account's own team; it keeps everything when there is no team to filter by. */
export function matchesTeam(row: TeamRow, filter: TeamFilter, myTeamId: number | null): boolean {
  if (filter === 'all' || myTeamId === null) return true;
  return row.entityTag === 1 && row.entityId === myTeamId;
}
