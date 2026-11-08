import type { Params } from './types';

/**
 * Display names for the contract's lock tiers, in the order of the amount locked. The names come from the
 * sealing-wax world and carry no rank, price or return: they only tell the tiers apart.
 */
export const TIER_NAMES = ['Ribbon', 'Wax', 'Signet'] as const;

export type LockTier = Params['lockTiers'][number];

export interface NamedTier extends LockTier {
  /** Zero-based position in amount order. */
  index: number;
  name: string;
}

/**
 * The tiers sorted by locked amount and named by position. The contract allows at most three, but a tier
 * count outside the three known names still gets distinct, honest labels ("Tier 4") rather than a crash.
 */
export function nameTiers(tiers: readonly LockTier[]): NamedTier[] {
  return [...tiers]
    .sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0))
    .map((t, index) => ({ ...t, index, name: TIER_NAMES[index] ?? `Tier ${index + 1}` }));
}
