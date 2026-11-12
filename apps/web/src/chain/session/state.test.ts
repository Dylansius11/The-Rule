import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { active } from '@/config/env';
import type { StoredKey } from './keystore';
import { SESSION_METHODS, SessionRejected, type OnChainKey } from './policy';

vi.mock('./keystore', () => ({
  keyId: (network: string, game: string, account: string) => `${network}|${game}|${account}`,
  supportsSessionKeys: vi.fn(async () => true),
  loadKey: vi.fn(),
  saveKey: vi.fn(async () => undefined),
  deleteKey: vi.fn(async () => undefined),
  generateKey: vi.fn(),
}));
vi.mock('./chain', () => ({ viewAccessKey: vi.fn() }));
vi.mock('./signer', () => ({ sendWithKey: vi.fn(), forgetAccount: vi.fn() }));
vi.mock('../connector', () => ({ getConnector: vi.fn() }));

import { viewAccessKey } from './chain';
import { deleteKey, loadKey, saveKey } from './keystore';
import { sendWithKey } from './signer';
import { adoptConnectKey, attach, detach, getSnapshot, trySend } from './state';

const stored: StoredKey = {
  privateKey: {} as CryptoKey,
  publicKey: 'ed25519:FFgyL2xeh7SULicpnmoiMJ6r2oyyKW3nEjQkeuJ9EkEQ',
};
const onChain = (allowance = '500000000000000000000000'): OnChainKey => ({
  nonce: 1,
  permission: {
    FunctionCall: { allowance, receiver_id: active.game, method_names: [...SESSION_METHODS] },
  },
});
const call = { methodName: 'play', args: { mode: 0, number: 1, word: 'otter' }, gas: 300_000_000_000_000n };
const outcome = { status: { SuccessValue: '' }, transaction: { hash: 'abc' } };

beforeEach(async () => {
  await detach();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('trySend', () => {
  it('signs locally and refreshes the allowance when the key is healthy', async () => {
    vi.mocked(loadKey).mockResolvedValue(stored);
    vi.mocked(viewAccessKey).mockResolvedValue(onChain());
    vi.mocked(sendWithKey).mockResolvedValue(outcome as never);
    await attach('alice.testnet');
    expect(getSnapshot().status).toBe('active');

    await expect(trySend(call)).resolves.toBe(outcome);
    expect(sendWithKey).toHaveBeenCalledTimes(1);
    expect(sendWithKey).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'alice.testnet', receiverId: active.game, methodName: 'play' }),
    );
  });

  it('hands the action to the wallet when no key is stored, without trying to sign', async () => {
    vi.mocked(loadKey).mockResolvedValue(null);
    await attach('alice.testnet');
    expect(getSnapshot().status).toBe('off');
    await expect(trySend(call)).resolves.toBeNull();
    expect(sendWithKey).not.toHaveBeenCalled();
  });

  it('refuses a stored key the chain no longer has', async () => {
    vi.mocked(loadKey).mockResolvedValue(stored);
    vi.mocked(viewAccessKey).mockResolvedValue(null);
    await attach('alice.testnet');
    expect(getSnapshot().status).toBe('off');
    await expect(trySend(call)).resolves.toBeNull();
    expect(sendWithKey).not.toHaveBeenCalled();
  });

  it('does not guess when the chain cannot be read: wallet path, no signing', async () => {
    vi.mocked(loadKey).mockResolvedValue(stored);
    vi.mocked(viewAccessKey).mockRejectedValue(new Error('RPC unavailable'));
    await attach('alice.testnet');
    expect(getSnapshot().status).toBe('off');
    await expect(trySend(call)).resolves.toBeNull();
    expect(sendWithKey).not.toHaveBeenCalled();
  });

  it('drops the key, says why and falls back once when the network rejected it before running', async () => {
    vi.mocked(loadKey).mockResolvedValue(stored);
    vi.mocked(viewAccessKey).mockResolvedValue(onChain());
    vi.mocked(sendWithKey).mockRejectedValue(
      new SessionRejected('allowance', new Error('NotEnoughAllowance')),
    );
    await attach('alice.testnet');

    await expect(trySend(call)).resolves.toBeNull();
    expect(sendWithKey).toHaveBeenCalledTimes(1);
    expect(deleteKey).toHaveBeenCalledTimes(1);
    const snapshot = getSnapshot();
    expect(snapshot.status).toBe('off');
    expect(snapshot.notice).toMatch(/gas allowance/);
    // The key is gone: the next call must not try to sign again.
    await expect(trySend(call)).resolves.toBeNull();
    expect(sendWithKey).toHaveBeenCalledTimes(1);
  });

  it('never redirects an ambiguous failure to the wallet, since the call may have landed', async () => {
    vi.mocked(loadKey).mockResolvedValue(stored);
    vi.mocked(viewAccessKey).mockResolvedValue(onChain());
    const timeout = new Error('request timed out');
    vi.mocked(sendWithKey).mockRejectedValue(timeout);
    await attach('alice.testnet');

    await expect(trySend(call)).rejects.toBe(timeout);
    expect(sendWithKey).toHaveBeenCalledTimes(1);
    expect(deleteKey).not.toHaveBeenCalled();
    expect(getSnapshot().status).toBe('active');
  });
});

describe('detach', () => {
  it('deletes the account’s key from the device on sign-out', async () => {
    vi.mocked(loadKey).mockResolvedValue(stored);
    vi.mocked(viewAccessKey).mockResolvedValue(onChain());
    await attach('alice.testnet');
    await detach();
    expect(deleteKey).toHaveBeenCalledWith(expect.stringContaining('alice.testnet'));
    expect(getSnapshot().accountId).toBeNull();
  });
});

describe('adoptConnectKey', () => {
  it('keeps and saves the key once the wallet has really added it', async () => {
    vi.mocked(loadKey).mockResolvedValue(null);
    vi.mocked(viewAccessKey).mockResolvedValue(onChain());
    await adoptConnectKey('alice.testnet', stored);
    expect(saveKey).toHaveBeenCalledTimes(1);
    expect(getSnapshot().status).toBe('active');
  });

  it('drops the key and says so when the wallet quietly did not add it', async () => {
    vi.useFakeTimers();
    vi.mocked(loadKey).mockResolvedValue(null);
    vi.mocked(viewAccessKey).mockResolvedValue(null);
    const adopting = adoptConnectKey('alice.testnet', stored);
    await vi.runAllTimersAsync();
    await adopting;
    expect(saveKey).not.toHaveBeenCalled();
    expect(getSnapshot().status).toBe('off');
    expect(getSnapshot().reason).toMatch(/did not add/);
    await expect(trySend(call)).resolves.toBeNull();
  });
});
