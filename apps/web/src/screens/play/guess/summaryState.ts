import type { BlotState } from '@/mascot/Blot';

export interface SummaryState {
  /** Blot's pose. Only poses that mean what happened: waiting, or nothing yet. */
  pose: Extract<BlotState, 'idle' | 'pending'>;
  /** Blot's short line. Never about money and never claims the guess is right. */
  line: string;
}

/** How Blot looks in the "Your guess" panel, from whether a guess is drafted and whether its commit is in flight. */
export function summaryState(hasRule: boolean, committing: boolean): SummaryState {
  if (committing) return { pose: 'pending', line: 'Hmm hmm… sealing it on the chain.' };
  if (!hasRule) return { pose: 'idle', line: 'Pick your atoms.' };
  return { pose: 'idle', line: 'Ready to seal when you are.' };
}
