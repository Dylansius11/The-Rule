import { beforeEach, describe, expect, it, vi } from 'vitest';

const settleTeam = vi.fn();
vi.mock('@/chain/calls', () => ({ settleTeam: (...args: unknown[]) => settleTeam(...args) }));

import { unlockTeam } from './unlock';

describe('unlockTeam', () => {
  beforeEach(() => {
    settleTeam.mockReset();
  });

  it('sends settle_team for the team and resolves on success', async () => {
    settleTeam.mockResolvedValue({ status: { SuccessValue: '' } });
    await expect(unlockTeam(7)).resolves.toBeUndefined();
    expect(settleTeam).toHaveBeenCalledWith(7);
  });

  it('treats E56 in a failed outcome as already unlocked', async () => {
    settleTeam.mockResolvedValue({
      status: {
        Failure: {
          ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: E56' } } },
        },
      },
    });
    await expect(unlockTeam(7)).resolves.toBeUndefined();
  });

  it('treats an E56 thrown by the signing path as already unlocked', async () => {
    settleTeam.mockImplementation(async () => {
      throw new Error('Smart contract panicked: E56');
    });
    await unlockTeam(7);
    expect(settleTeam).toHaveBeenCalledTimes(1);
  });

  it('rethrows every other failure', async () => {
    settleTeam.mockResolvedValue({ status: { Failure: { error: 'E21 entity pending' } } });
    await expect(unlockTeam(7)).rejects.toThrow('E21');
    settleTeam.mockImplementation(async () => {
      throw new Error('User rejected');
    });
    await expect(unlockTeam(7)).rejects.toThrow('User rejected');
  });
});
