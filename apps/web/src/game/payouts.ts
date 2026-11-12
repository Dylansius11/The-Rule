import type { Mode } from './types';

/** One signed step of "Claim all". Both calls are the contract's own; nothing here moves NEAR out of the game. */
export type PayoutItem =
  /** `settle_team`: returns the team's correct stakes and refunds to its vault and lifts the round lock. */
  | { kind: 'unlock'; teamId: number; roundId: number }
  /** `claim` (Solo) or `claim_team` (Team): credits the account's share to its game credit. */
  | { kind: 'claim'; mode: Mode; roundId: number; amount: bigint; teamId: number | null };

const TERMINAL_PHASES = ['Settled', 'Cancelled', 'Void'];
export const isTerminalPhase = (phase: string): boolean => TERMINAL_PHASES.includes(phase);

export interface PayoutInput {
  /** The account's current team, with the phase of the round the team is locked to, if any. */
  team: { teamId: number; activeRound: number | null; activeRoundPhase: string | null } | null;
  /** What `get_claimable` says per observed round. */
  claims: readonly { mode: Mode; roundId: number; phase: string; claimable: bigint }[];
}

/**
 * Everything the account can collect right now, in the order it should be sent: unlock the team first (so its
 * next round is not refused with E30), then each claim, newest round first. A round that has not ended, a zero
 * claim and a Team claim without a current team are skipped, never guessed.
 */
export function planPayouts({ team, claims }: PayoutInput): PayoutItem[] {
  const items: PayoutItem[] = [];
  if (
    team &&
    team.activeRound !== null &&
    team.activeRoundPhase !== null &&
    isTerminalPhase(team.activeRoundPhase)
  )
    items.push({ kind: 'unlock', teamId: team.teamId, roundId: team.activeRound });
  const owed = claims
    .filter(c => isTerminalPhase(c.phase) && c.claimable > 0n && (c.mode === 0 || team !== null))
    .sort((a, b) => b.roundId - a.roundId || a.mode - b.mode);
  for (const c of owed)
    items.push({
      kind: 'claim',
      mode: c.mode,
      roundId: c.roundId,
      amount: c.claimable,
      teamId: c.mode === 1 ? team!.teamId : null,
    });
  return items;
}

export const payoutTotal = (items: readonly PayoutItem[]): bigint =>
  items.reduce((sum, item) => (item.kind === 'claim' ? sum + item.amount : sum), 0n);
