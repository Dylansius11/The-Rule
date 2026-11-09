import { PublicKey, Signer, baseDecode, baseEncode } from 'near-api-js';

class NativeSigner extends Signer {
  private readonly key: CryptoKey;
  private readonly publicKey: PublicKey;
  constructor(key: CryptoKey, publicKey: PublicKey) {
    super();
    this.key = key;
    this.publicKey = publicKey;
  }
  async getPublicKey(): Promise<PublicKey> { return this.publicKey; }
  protected async signBytes(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.sign('Ed25519', this.key, bytes as BufferSource));
  }
}

// NEAR's Ed25519 secret encoding is seed(32) || public(32). WebCrypto handles
// the curve in the runtime rather than spending the Free Cron's CPU in JS.
export async function createNativeSigner(secret: string): Promise<Signer> {
  if (!secret.startsWith('ed25519:')) throw new Error('Keeper requires Ed25519');
  const raw = baseDecode(secret.slice('ed25519:'.length));
  if (raw.length !== 64) { raw.fill(0); throw new Error('Invalid keeper key'); }
  const pkcs8 = new Uint8Array(48);
  pkcs8.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  pkcs8.set(raw.subarray(0, 32), 16);
  try {
    const publicBytes = raw.subarray(32);
    const publicKey = PublicKey.fromString(`ed25519:${baseEncode(publicBytes)}`);
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', false, ['sign']);
    const verifier = await crypto.subtle.importKey('raw', publicBytes as BufferSource, 'Ed25519', false, ['verify']);
    const challenge = new Uint8Array([0]);
    const signature = await crypto.subtle.sign('Ed25519', key, challenge);
    if (!await crypto.subtle.verify('Ed25519', verifier, signature, challenge)) throw new Error('Mismatched keeper key');
    return new NativeSigner(key, publicKey);
  } finally {
    raw.fill(0);
    pkcs8.fill(0);
  }
}
