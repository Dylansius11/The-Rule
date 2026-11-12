import * as calls from '@/chain/calls';

/** The contract answers `settle_team` with E56 when the team has no round to settle: someone already did. */
const ALREADY_UNLOCKED = /\bE56\b/;

/**
 * `settle_team`, treating "already unlocked" as success. Two teammates' pages, a Team stamp and Leave can all
 * unlock the same team at once; the loser's E56 means the goal is already reached, not that something broke.
 * Any other failure is thrown as is.
 */
export async function unlockTeam(teamId: number): Promise<void> {
  let outcome;
  try {
    outcome = await calls.settleTeam(teamId);
  } catch (error) {
    if (ALREADY_UNLOCKED.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  const status = outcome.status;
  if (typeof status === 'object' && 'Failure' in status) {
    const failure = JSON.stringify(status.Failure);
    if (ALREADY_UNLOCKED.test(failure)) return;
    throw new Error(failure);
  }
}
