import { describe, expect, it } from 'vitest';
import * as near from 'near-api-js';
import * as rpc from 'near-api-js/rpc-errors';
import { generateKey } from './keystore';
import { classifyRejection, createSigner } from './signer';

const publicKey = near.PublicKey.from('ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp');

describe('createSigner', () => {
  it('signs a transaction that the key’s public half verifies', async () => {
    const stored = await generateKey();
    expect(stored.privateKey.extractable).toBe(false);
    const signer = createSigner(near, stored);
    const tx = near.createTransaction(
      'alice.testnet',
      near.PublicKey.from(stored.publicKey),
      'demo-game.therule.testnet',
      7n,
      [near.actions.functionCall('play', { mode: 0, number: 1, word: 'otter' }, 300_000_000_000_000n, 0n)],
      new Uint8Array(32),
    );
    const { txHash, signedTransaction } = await signer.signTransaction(tx);
    const publicKeyOf = near.PublicKey.from(stored.publicKey);
    expect(publicKeyOf.verify(txHash, signedTransaction.signature.signature!.data)).toBe(true);
  });
});

describe('classifyRejection', () => {
  const nonce = () => new rpc.InvalidNonceError(5, 4, 'hash', 'block');
  const allowance = () =>
    new rpc.AccessKeyNotEnoughAllowanceActionError('alice.testnet', 1n, 2n, publicKey, 0, 'hash', 'block');
  const missing = () => new rpc.AccessKeyDoesNotExistError(publicKey, 'block', 1);

  it('recognises a key the network rejected before running anything', () => {
    return Promise.all([
      expect(classifyRejection(nonce())).resolves.toBe('nonce'),
      expect(classifyRejection(allowance())).resolves.toBe('allowance'),
      expect(classifyRejection(missing())).resolves.toBe('key-missing'),
    ]);
  });

  it('unwraps failover errors when every node gave a definitive rejection', async () => {
    await expect(classifyRejection({ errors: [allowance(), allowance()] })).resolves.toBe('allowance');
  });

  it('never calls it a rejection when any node failed ambiguously, since the call may have landed', async () => {
    await expect(
      classifyRejection({ errors: [new Error('request timed out'), nonce()] }),
    ).resolves.toBeNull();
    await expect(classifyRejection(new Error('Failed to fetch'))).resolves.toBeNull();
    await expect(classifyRejection({ errors: [] })).resolves.toBeNull();
  });
});
