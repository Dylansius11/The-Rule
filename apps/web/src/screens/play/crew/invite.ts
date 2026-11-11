import type { Team } from '@/game/types';

const U32_MAX = 0xffff_ffff;

/** A link that opens the crew desk with the team id filled in. It grants nothing: the captain still invites accounts. */
export const inviteLink = (origin: string, teamId: number): string =>
  `${origin}/play/team/crew?join=${teamId}`;

/** The team id in `?join=`, only when it is a plain u32. */
export function joinIdFromSearch(search: string): number | null {
  const value = new URLSearchParams(search).get('join');
  if (value === null || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= U32_MAX ? id : null;
}

export type JoinStatus = 'invited' | 'not-invited' | 'full' | 'member';

/** Whether this account can join now. The contract only admits an invited account while the team has room. */
export function joinStatus(
  team: Pick<Team, 'members' | 'invites'>,
  me: string | null,
  maxTeamSize: number,
): JoinStatus {
  if (me !== null && team.members.includes(me)) return 'member';
  if (me === null || !team.invites.includes(me)) return 'not-invited';
  return team.members.length < maxTeamSize ? 'invited' : 'full';
}
