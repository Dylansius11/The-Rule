import { describe, expect, it } from 'vitest';
import { matchesTeam, teamIdsIn, teamLabel } from './ledgerTeams';

const row = (entityTag: number, entityId: number) => ({ entityTag, entityId });

describe('teamIdsIn', () => {
  it('lists each team once and ignores Solo rows', () => {
    expect(teamIdsIn([row(1, 3), row(0, 3), row(1, 1), row(1, 3)])).toEqual([3, 1]);
  });
});

describe('teamLabel', () => {
  it('names a live team and falls back to its number for a deleted one', () => {
    expect(teamLabel(1, 'ink-gang')).toBe('ink-gang #1');
    expect(teamLabel(1, null)).toBe('Team #1');
    expect(teamLabel(1, undefined)).toBe('Team #1');
  });
});

describe('matchesTeam', () => {
  it('keeps only my team when asked and a team exists', () => {
    expect(matchesTeam(row(1, 2), 'mine', 2)).toBe(true);
    expect(matchesTeam(row(1, 3), 'mine', 2)).toBe(false);
    expect(matchesTeam(row(0, 2), 'mine', 2)).toBe(false);
  });

  it('keeps everything for all teams, or when there is no team of mine', () => {
    expect(matchesTeam(row(1, 3), 'all', 2)).toBe(true);
    expect(matchesTeam(row(1, 3), 'mine', null)).toBe(true);
  });
});
