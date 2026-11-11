import { describe, expect, it } from 'vitest';
import { isReadyToPlay, nextStep, setupSteps, type SetupInput } from './setup';

const NEAR = 10n ** 24n;
const COST = 30_480_000_000_000_000_000_000n;

const base: SetupInput = {
  connected: true,
  session: 'active',
  storagePaid: true,
  token: 'registered',
  credit: 1n * NEAR,
  cost: COST,
};
const steps = (over: Partial<SetupInput> = {}) => setupSteps({ ...base, ...over });
const status = (over: Partial<SetupInput>) =>
  Object.fromEntries(steps(over).map(step => [step.id, step.status]));

describe('setupSteps', () => {
  it('is all done for a connected, funded, registered player with a key', () => {
    expect(status({})).toEqual({ connect: 'done', key: 'done', credit: 'done', rule: 'done' });
    expect(nextStep(steps())).toBeNull();
  });

  it('puts connect first and holds back everything behind it', () => {
    const list = steps({ connected: false, session: 'off', storagePaid: null, token: null, credit: null });
    expect(nextStep(list)?.id).toBe('connect');
    expect(list.filter(step => step.status === 'next')).toHaveLength(1);
  });

  it('asks for the key, then credit, then RULE, in that order', () => {
    expect(nextStep(steps({ session: 'off', credit: 0n, token: 'none', storagePaid: false }))?.id).toBe(
      'key',
    );
    expect(nextStep(steps({ credit: 0n, token: 'none', storagePaid: false }))?.id).toBe('credit');
    expect(nextStep(steps({ token: 'none', storagePaid: false }))?.id).toBe('rule');
  });

  it('treats a key that cannot exist here as skipped, never as a blocker', () => {
    const list = steps({ session: 'unsupported', credit: 0n });
    expect(list.find(step => step.id === 'key')?.status).toBe('unavailable');
    expect(nextStep(list)?.id).toBe('credit');
  });

  it('counts a low-allowance key as set up and credit as done only when one play is affordable', () => {
    expect(status({ session: 'low' }).key).toBe('done');
    expect(status({ credit: COST - 1n }).credit).toBe('next');
    expect(status({ credit: COST }).credit).toBe('done');
  });

  it('does not nag while a value is still being read', () => {
    const list = steps({ session: 'checking', credit: null });
    expect(list.find(step => step.id === 'key')?.status).toBe('loading');
    expect(nextStep(list)).toBeNull();
  });

  it('keeps RULE open until the game, not just the token, confirms it', () => {
    expect(status({ token: 'none', storagePaid: true }).rule).toBe('next');
    expect(status({ token: 'pending', storagePaid: true }).rule).toBe('loading');
    expect(status({ token: 'registered', storagePaid: false }).rule).toBe('done');
  });
});

describe('isReadyToPlay', () => {
  it('needs only a wallet and credit for one play; the key and RULE are optional', () => {
    expect(isReadyToPlay({ ...base, session: 'off', token: 'none', storagePaid: false })).toBe(true);
    expect(isReadyToPlay({ ...base, credit: 0n })).toBe(false);
    expect(isReadyToPlay({ ...base, connected: false })).toBe(false);
    expect(isReadyToPlay({ ...base, credit: null })).toBe(false);
  });
});
