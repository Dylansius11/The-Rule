import type { BlotState } from '@/mascot/Blot';
import type { Check } from './useGuessDraft';

export interface SummaryState {
  /** Blot's pose. Only poses that mean what happened: waiting, or "that one disagrees". */
  pose: Extract<BlotState, 'idle' | 'pending' | 'no'>;
  /** Blot's short line. Never about money and never claims the guess is right. */
  line: string;
  /** The free-check status in plain words. */
  status: string;
  /** True when the free check found a disagreement. */
  disagrees: boolean;
}

/** What the "Your guess" panel says and how Blot looks, from the guess draft and the commit in flight. */
export function summaryState(hasRule: boolean, check: Check, committing: boolean): SummaryState {
  if (committing)
    return {
      pose: 'pending',
      line: 'Hmm hmm… sealing it on the chain.',
      status: 'Sending your commit. Wait for it to be recorded.',
      disagrees: false,
    };
  if (!hasRule)
    return {
      pose: 'idle',
      line: 'Pick your atoms. Testing is free.',
      status: 'Nothing to check yet. Write your guess first.',
      disagrees: false,
    };
  switch (check.kind) {
    case 'running':
      return {
        pose: 'pending',
        line: 'Replaying it against the ledger…',
        status: 'Checking against the ledger…',
        disagrees: false,
      };
    case 'done':
      return check.consistent
        ? {
            pose: 'idle',
            line: 'It fits so far. That is not proof.',
            status: `Consistent with all ${check.rows} logged verdicts. Other guesses can fit too.`,
            disagrees: false,
          }
        : {
            pose: 'no',
            line: 'That one disagrees with the ledger.',
            status: `Disagrees with ${check.mismatches.length} logged verdict${check.mismatches.length === 1 ? '' : 's'}, so it cannot be the rule.`,
            disagrees: true,
          };
    case 'error':
      return {
        pose: 'idle',
        line: 'The check did not run.',
        status: `The local check could not run: ${check.message}. Nothing was sent.`,
        disagrees: false,
      };
    default:
      return {
        pose: 'idle',
        line: 'Ready to test. It is free.',
        status: 'Not checked yet. Open step 2 to test it for free.',
        disagrees: false,
      };
  }
}
