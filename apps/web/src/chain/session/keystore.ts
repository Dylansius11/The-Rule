import { loadNear } from './near';

/**
 * A session key lives only as a non-extractable WebCrypto Ed25519 private key in IndexedDB: this page
 * can ask it to sign, nothing can read the secret back out. When the browser cannot do that there is
 * no key and no weaker store; callers fall back to normal wallet approvals.
 */
export interface StoredKey {
  privateKey: CryptoKey;
  /** `ed25519:<base58>`, the form NEAR and near-connect use. */
  publicKey: string;
}

const DB_NAME = 'the-rule-session';
const STORE = 'keys';

/** One key per network, game contract and account, so Demo and the main game never share one. */
export const keyId = (network: string, game: string, accountId: string) => `${network}|${game}|${accountId}`;

let support: Promise<boolean> | undefined;

/** True only when this browser can generate, sign with and persist a non-extractable Ed25519 key. */
export function supportsSessionKeys(): Promise<boolean> {
  support ??= (async () => {
    try {
      if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return false;
      const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
        'sign',
        'verify',
      ])) as CryptoKeyPair;
      return pair.privateKey.extractable === false;
    } catch {
      return false;
    }
  })();
  return support;
}

export async function generateKey(): Promise<StoredKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const { PublicKey, KeyType } = await loadNear();
  const publicKey = new PublicKey({ keyType: KeyType.ED25519, data: raw }).toString();
  return { privateKey: pair.privateKey, publicKey };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

export async function saveKey(id: string, key: StoredKey): Promise<void> {
  await run('readwrite', store => store.put(key, id));
}

export async function loadKey(id: string): Promise<StoredKey | null> {
  const value = (await run('readonly', store => store.get(id))) as StoredKey | undefined;
  return value && value.privateKey instanceof CryptoKey && typeof value.publicKey === 'string' ? value : null;
}

export async function deleteKey(id: string): Promise<void> {
  await run('readwrite', store => store.delete(id));
}
