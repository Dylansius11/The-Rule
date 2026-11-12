import type { DeploymentChoice } from '@/config/env';
import type { Team } from '@/game/types';

const U32_MAX = 0xffff_ffff;

/**
 * A link that opens the crew desk with the team id filled in and the deployment the id belongs to, since the
 * same id means a different team in Demo and in the real game. It grants nothing: the captain still invites accounts.
 */
export const inviteLink = (origin: string, teamId: number, deployment: DeploymentChoice): string =>
  `${origin}/play/team/crew?join=${teamId}&deployment=${deployment}`;

/** The team id in `?join=`, only when it is a plain u32. */
export function joinIdFromSearch(search: string): number | null {
  const value = new URLSearchParams(search).get('join');
  if (value === null || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= U32_MAX ? id : null;
}

/** A NEAR account id as the contract accepts it: 2 to 64 lowercase letters, digits, `.`, `_` or `-`. */
const ACCOUNT_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])$/;

/**
 * A link a not-yet-invited friend sends back. It opens the captain's crew desk with this account's name already
 * in "Invite a member", so the captain only presses Invite.
 */
export const requestLink = (origin: string, account: string, deployment: DeploymentChoice): string =>
  `${origin}/play/team/crew?invite=${encodeURIComponent(account)}&deployment=${deployment}`;

/** The account in `?invite=`, only when it is a well-formed account id. */
export function inviteAccountFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('invite');
  return value !== null && ACCOUNT_ID.test(value) ? value : null;
}

/**
 * Why an account can or cannot join now, in the order the player should fix things. Mirrors `join_team`: the
 * account must be a game player (E20), in no team (E33), invited (E33), the team must have room (E31) and not be
 * mid-round (E30).
 */
export type JoinStatus =
  'member' | 'in-other-team' | 'not-invited' | 'full' | 'locked' | 'no-player' | 'invited';

export function joinStatus(
  team: Pick<Team, 'members' | 'invites' | 'activeRound'>,
  me: { account: string | null; teamId: number | null; isPlayer: boolean },
  maxTeamSize: number,
): JoinStatus {
  if (me.account !== null && team.members.includes(me.account)) return 'member';
  if (me.teamId !== null) return 'in-other-team';
  if (me.account === null || !team.invites.includes(me.account)) return 'not-invited';
  if (team.members.length >= maxTeamSize) return 'full';
  if (team.activeRound !== null) return 'locked';
  return me.isPlayer ? 'invited' : 'no-player';
}
