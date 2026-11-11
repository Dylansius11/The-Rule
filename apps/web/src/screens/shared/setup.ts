import type { SessionStatus } from '@/chain/session/policy';

export type StepId = 'connect' | 'key' | 'credit' | 'rule';
/** `loading`: a value is still being read, so nothing is asked of the player yet. `unavailable`: cannot apply here. */
export type StepStatus = 'done' | 'next' | 'todo' | 'loading' | 'unavailable';

export interface SetupInput {
  connected: boolean;
  session: SessionStatus;
  /** The token storage is paid. Null while unread. */
  storagePaid: boolean | null;
  /** The game's own view of the RULE registration. Null while unread. */
  token: 'none' | 'pending' | 'registered' | null;
  /** Game credit in yoctoNEAR. Null while unread. */
  credit: bigint | null;
  /** One paid play: fee plus storage charge. Null while unread. */
  cost: bigint | null;
}

export interface SetupStep {
  id: StepId;
  status: StepStatus;
  /** Needed before the first play. The key and RULE are recommended, not required. */
  required: boolean;
}

/**
 * The first-play checklist in the order a player meets it: wallet, session key, credit, RULE. Exactly one open
 * step is `next`, and only once everything before it has been read, so the page never asks for something that
 * the chain may already have.
 */
export function setupSteps(input: SetupInput): SetupStep[] {
  const { connected, session, storagePaid, token, credit, cost } = input;
  const key: StepStatus =
    session === 'unsupported'
      ? 'unavailable'
      : session === 'active' || session === 'low'
        ? 'done'
        : session === 'checking'
          ? 'loading'
          : 'todo';
  const creditStatus: StepStatus =
    credit === null || cost === null ? 'loading' : credit >= cost ? 'done' : 'todo';
  const rule: StepStatus =
    token === 'registered'
      ? 'done'
      : token === null || storagePaid === null
        ? 'loading'
        : token === 'pending'
          ? 'loading'
          : 'todo';
  const raw: SetupStep[] = [
    { id: 'connect', status: connected ? 'done' : 'todo', required: true },
    { id: 'key', status: connected ? key : 'todo', required: false },
    { id: 'credit', status: connected ? creditStatus : 'todo', required: true },
    { id: 'rule', status: connected ? rule : 'todo', required: false },
  ];
  // The first open step is the one to do now. A step still being read blocks the ones after it.
  const out: SetupStep[] = [];
  let blocked = false;
  for (const step of raw) {
    if (!blocked && step.status === 'todo') {
      out.push({ ...step, status: 'next' });
      blocked = true;
    } else {
      if (step.status === 'loading') blocked = true;
      out.push(step);
    }
  }
  return out;
}

export const nextStep = (steps: readonly SetupStep[]): SetupStep | null =>
  steps.find(step => step.status === 'next') ?? null;

/** One play is affordable: a connected wallet and enough credit. The key and RULE can wait. */
export function isReadyToPlay(input: SetupInput): boolean {
  return input.connected && input.credit !== null && input.cost !== null && input.credit >= input.cost;
}
