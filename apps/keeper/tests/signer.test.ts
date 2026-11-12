import { describe, expect, it } from 'vitest';
import { KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, createTransaction } from 'near-api-js';
import { createNativeSigner } from '../src/signer.ts';

// Public RFC 8032 vector; never a funded account or operational credential.
const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const publicHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const secret = `ed25519:${baseEncode(Buffer.from(seed + publicHex, 'hex'))}` as const;

describe('native keeper signer', () => {
  it('produces SDK-compatible transaction signatures bound to the exact transaction', async () => {
    const native = await createNativeSigner(secret);
    const pair = KeyPair.fromString(secret);
    const publicKey = pair.getPublicKey();
    const transaction = createTransaction('keeper.testnet', publicKey, 'game.testnet', 9007199254740993n,
      [actions.functionCall('advance', { mode: 0, round_id: 7 }, 300_000_000_000_000n, 0n)], new Uint8Array(32));
    const actual = await native.signTransaction(transaction);
    const expected = await new KeyPairSigner(pair).signTransaction(transaction);
    expect(actual.txHash).toEqual(expected.txHash);
    expect(actual.signedTransaction.signature).toEqual(expected.signedTransaction.signature);
    const signature = actual.signedTransaction.signature.ed25519Signature!.data;
    expect(publicKey.verify(actual.txHash, signature)).toBe(true);
    const changed = createTransaction('keeper.testnet', publicKey, 'game.testnet', 9007199254740994n,
      transaction.actions, new Uint8Array(32));
    const changedHash = (await native.signTransaction(changed)).txHash;
    expect(publicKey.verify(changedHash, signature)).toBe(false);
  });

  it('rejects a seed paired with another public key and malformed encodings', async () => {
    const mismatched = baseDecode(secret.slice('ed25519:'.length));
    mismatched[63] ^= 1;
    await expect(createNativeSigner(`ed25519:${baseEncode(mismatched)}`)).rejects.toThrow('Mismatched keeper key');
    await expect(createNativeSigner(`ed25519:${baseEncode(new Uint8Array(32))}`)).rejects.toThrow('Invalid keeper key');
    await expect(createNativeSigner('secp256k1:invalid')).rejects.toThrow('Keeper requires Ed25519');
    await expect(createNativeSigner('ed25519:not-valid!')).rejects.toThrow();
  });
});
