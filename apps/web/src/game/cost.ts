import type { Mode, Params } from './types';

const BPS = 10_000n;

/** Basis points as a percentage string: 8000 -> "80%", 150 -> "1.5%". */
export function bpsPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0').replace(/0+$/, '')}%`;
}

/** `amount x bps / 10000`, rounded down like the contract's integer maths. */
export const shareOf = (amount: bigint, bps: number): bigint => (amount * BigInt(bps)) / BPS;

/** Stake locked by a commit: the larger of the floor and the mode's share of the pot. */
export function stakeFor(pot: bigint, bps: number, min: bigint): bigint {
  const part = shareOf(pot, bps);
  return part < min ? min : part;
}

export interface PlayCost {
  fee: bigint;
  storage: bigint;
  total: bigint;
}

/** What one paid play costs the player: the play fee plus the non-refundable storage charge. */
export function playCost(p: Pick<Params, 'playFee' | 'storagePerPlay'>): PlayCost {
  return { fee: p.playFee, storage: p.storagePerPlay, total: p.playFee + p.storagePerPlay };
}

export interface GuessCost {
  /** Stake at the current pot, or at the floor when no pot is known. */
  stake: bigint;
  storage: bigint;
  total: bigint;
  /** Share of the pot the stake is computed from, in basis points. */
  bps: number;
  /** True when the floor decides the stake (or when there is no pot to compute from). */
  atFloor: boolean;
  /** False when the stake could only be shown at the floor because no round pot is known. */
  potKnown: boolean;
}

/** What one guess costs: the locked stake plus the storage charge (the charge never comes back). */
export function guessCost(
  p: Pick<Params, 'stakeBps' | 'stakeMin' | 'storagePerPlay'>,
  mode: Mode,
  pot: bigint | null,
): GuessCost {
  const bps = p.stakeBps[mode];
  const stake = pot === null ? p.stakeMin : stakeFor(pot, bps, p.stakeMin);
  return {
    stake,
    storage: p.storagePerPlay,
    total: stake + p.storagePerPlay,
    bps,
    atFloor: pot === null || shareOf(pot, bps) <= p.stakeMin,
    potKnown: pot !== null,
  };
}

export interface SplitRow {
  label: string;
  bps: number;
  percent: string;
  /** Amount at the given base, or null when there is no base to apply it to. */
  amount: bigint | null;
}

function rows(labels: readonly string[], bps: readonly number[], base: bigint | null): SplitRow[] {
  return labels.map((label, i) => ({
    label,
    bps: bps[i]!,
    percent: bpsPercent(bps[i]!),
    amount: base === null ? null : shareOf(base, bps[i]!),
  }));
}

/** Where one play fee goes. */
export function feeSplitRows(p: Pick<Params, 'feeSplitBps' | 'playFee'>): SplitRow[] {
  return rows(['The pot', 'Compute for the sealed program', 'Platform'], p.feeSplitBps, p.playFee);
}

/** How a final pot is divided. Amounts are applied to `pot` when one is given. */
export function potSplitRows(
  solved: boolean,
  p: Pick<Params, 'solvedSplitBps' | 'unsolvedSplitBps'>,
  pot: bigint | null,
): SplitRow[] {
  return solved
    ? rows(['Winner', 'Contributors', 'Rollover to the next round', 'Platform'], p.solvedSplitBps, pot)
    : rows(['Contributors', 'Rollover to the next round', 'Platform'], p.unsolvedSplitBps, pot);
}

/** A wrong or unrevealed guess: the part returned to the guesser and the part that joins the pot. */
export function wrongGuess(stake: bigint, wrongReturnBps: number): { back: bigint; toPot: bigint } {
  const back = shareOf(stake, wrongReturnBps);
  return { back, toPot: stake - back };
}

/** Plain-language sentence for a split, e.g. "Winner 40%, Contributors 40%, Rollover to the next round 10%, Platform 10%". */
export function splitText(rowsIn: readonly SplitRow[]): string {
  return rowsIn.map(r => `${r.label} ${r.percent}`).join(', ');
}
