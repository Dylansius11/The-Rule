import { active, config } from '@/config/env';
import { getConnector, type WalletOutcome } from '../connector';
import { viewAccessKey } from './chain';
import {
  deleteKey,
  generateKey,
  keyId,
  loadKey,
  saveKey,
  supportsSessionKeys,
  type StoredKey,
} from './keystore';
import { SESSION_ALLOWANCE, SESSION_METHODS, SessionRejected, assessKey, type SessionStatus } from './policy';
import { forgetAccount, sendWithKey } from './signer';

export interface SessionSnapshot {
  status: SessionStatus;
  accountId: string | null;
  publicKey: string | null;
  /** Gas allowance left, yoctoNEAR; null when unknown. */
  allowance: bigint | null;
  /** Why the key is not usable, in plain words. */
  reason: string | null;
  /** Something the player should know happened, e.g. a fallback to the wallet. */
  notice: string | null;
  /** An enable or revoke approval is in flight. */
  busy: boolean;
  /** How the call being signed right now is signed. */
  via: 'session' | 'wallet' | null;
}

const IDLE: SessionSnapshot = {
  status: 'off',
  accountId: null,
  publicKey: null,
  allowance: null,
  reason: null,
  notice: null,
  busy: false,
  via: null,
};

let snapshot: SessionSnapshot = IDLE;
const listeners = new Set<() => void>();
function set(patch: Partial<SessionSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}
export const getSnapshot = () => snapshot;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface Current {
  accountId: string;
  id: string;
  key: StoredKey | null;
}
let current: Current | null = null;
/** Bumped on every account change so a slow read can never overwrite a newer account's state. */
let generation = 0;

const NO_KEY = 'No session key on this device. Enable one to skip wallet popups for plays and guesses.';

let attaching: Promise<void> = Promise.resolve();

/** Called on every sign-in and on page restore. Loads this account's key and checks it on-chain. */
export function attach(accountId: string): Promise<void> {
  if (current?.accountId === accountId) return attaching;
  const gen = ++generation;
  current = { accountId, id: keyId(config.network, active.game, accountId), key: null };
  attaching = load(gen, current);
  return attaching;
}

async function load(gen: number, cur: Current): Promise<void> {
  if (!(await supportsSessionKeys())) {
    if (gen === generation) {
      set({
        ...IDLE,
        accountId: cur.accountId,
        status: 'unsupported',
        reason: 'This browser cannot keep a non-extractable Ed25519 key, so every action asks your wallet.',
      });
    }
    return;
  }
  set({ ...IDLE, accountId: cur.accountId, status: 'checking' });
  const key = await loadKey(cur.id).catch(() => null);
  if (gen !== generation) return;
  cur.key = key;
  if (!key) {
    set({ status: 'off', reason: NO_KEY });
    return;
  }
  await refresh();
}

/** Sign-out: forget the account and delete its key from this device. */
export async function detach(): Promise<void> {
  generation++;
  const gone = current;
  current = null;
  set(IDLE);
  if (gone) {
    if (gone.key) forgetAccount(gone.accountId, gone.key);
    await deleteKey(gone.id).catch(() => undefined);
  }
}

/** Read the key's real state from the chain: present, scoped, allowance left. */
export async function refresh(): Promise<void> {
  const cur = current;
  if (!cur?.key) return;
  const gen = generation;
  try {
    const assessment = assessKey(await viewAccessKey(cur.accountId, cur.key.publicKey), active.game);
    if (gen !== generation) return;
    set({
      status: assessment.status,
      allowance: assessment.allowance,
      reason: assessment.reason,
      publicKey: cur.key.publicKey,
    });
  } catch {
    if (gen !== generation) return;
    // The chain could not be read. Never guess: the wallet path stays the safe default.
    set({
      status: 'off',
      reason: 'Could not read the key from the chain (RPC unavailable). Wallet approvals are used meanwhile.',
    });
  }
}

/** Forget a key that failed: stop using it, delete it locally, say why. The on-chain key, if any, is untouched. */
async function dropKey(reason: string, notice: string | null) {
  const cur = current;
  if (!cur?.key) return;
  forgetAccount(cur.accountId, cur.key);
  cur.key = null;
  await deleteKey(cur.id).catch(() => undefined);
  set({ status: 'off', allowance: null, publicKey: null, reason, notice });
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** After a wallet approval the key may take a moment to appear; poll a few times, read-only. */
async function waitForKey(accountId: string, publicKey: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const onChain = await viewAccessKey(accountId, publicKey);
    if (onChain) return onChain;
    await sleep(1200);
  }
  return null;
}

/** Adopt the key that connect asked the wallet to add. Drops it if the wallet quietly did not. */
export async function adoptConnectKey(accountId: string, key: StoredKey): Promise<void> {
  await attach(accountId);
  if (!current || current.accountId !== accountId) return;
  current.key = key;
  try {
    if (!(await waitForKey(accountId, key.publicKey))) {
      current.key = null;
      set({ status: 'off', reason: 'Your wallet did not add the key. You can enable it with one approval.' });
      return;
    }
    await saveKey(current.id, key);
    await refresh();
  } catch {
    current.key = null;
    set({
      status: 'off',
      reason: 'Could not confirm the key on-chain. Wallet approvals are used meanwhile.',
    });
  }
}

function failed(outcome: WalletOutcome) {
  const status = outcome.status;
  return typeof status === 'object' && status !== null && 'Failure' in status ? status.Failure : null;
}

/** One wallet approval adds a fresh key (and removes the old one in the same transaction if it is still on-chain). */
export async function enable(): Promise<void> {
  const cur = current;
  if (!cur || snapshot.busy || snapshot.status === 'unsupported') return;
  set({ busy: true, notice: null });
  try {
    const fresh = await generateKey();
    const actions: unknown[] = [
      {
        type: 'AddKey',
        params: {
          publicKey: fresh.publicKey,
          accessKey: {
            permission: {
              receiverId: active.game,
              allowance: SESSION_ALLOWANCE.toString(),
              methodNames: [...SESSION_METHODS],
            },
          },
        },
      },
    ];
    if (cur.key && (await viewAccessKey(cur.accountId, cur.key.publicKey))) {
      actions.push({ type: 'DeleteKey', params: { publicKey: cur.key.publicKey } });
    }
    const wallet = await getConnector().wallet();
    const outcome = await wallet.signAndSendTransaction({
      receiverId: cur.accountId,
      actions: actions as Parameters<typeof wallet.signAndSendTransaction>[0]['actions'],
    });
    const failure = failed(outcome);
    if (failure) throw new Error(`The wallet reported a failure: ${JSON.stringify(failure)}`);
    if (!(await waitForKey(cur.accountId, fresh.publicKey))) {
      throw new Error('The key was sent but is not visible on-chain yet. Check again in a moment.');
    }
    if (current !== cur) return;
    if (cur.key) forgetAccount(cur.accountId, cur.key);
    cur.key = fresh;
    await saveKey(cur.id, fresh);
    await refresh();
  } catch (error) {
    set({ notice: error instanceof Error ? error.message : 'Enabling the session key failed.' });
  } finally {
    set({ busy: false });
  }
}

/** Remove the key from the account through the wallet, then from this device. */
export async function revoke(): Promise<void> {
  const cur = current;
  if (!cur?.key || snapshot.busy) return;
  set({ busy: true, notice: null });
  try {
    if (await viewAccessKey(cur.accountId, cur.key.publicKey)) {
      const wallet = await getConnector().wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId: cur.accountId,
        actions: [{ type: 'DeleteKey', params: { publicKey: cur.key.publicKey } }],
      });
      const failure = failed(outcome);
      if (failure) throw new Error(`The wallet reported a failure: ${JSON.stringify(failure)}`);
    }
    await dropKey('Session key revoked. Every action asks your wallet again.', null);
  } catch (error) {
    set({ notice: error instanceof Error ? error.message : 'Revoking the session key failed.' });
  } finally {
    set({ busy: false });
  }
}

export const dismissNotice = () => set({ notice: null });
export const markVia = (via: SessionSnapshot['via']) => set({ via });

/**
 * Sign one call with the session key. Returns null when the wallet must be used instead: no usable
 * key, or the network definitively rejected the key before anything ran. Any other failure throws and
 * is never redirected to the wallet, because the transaction may already have landed.
 */
export async function trySend(call: {
  methodName: string;
  args: object;
  gas: bigint;
}): Promise<WalletOutcome | null> {
  const cur = current;
  if (!cur?.key || (snapshot.status !== 'active' && snapshot.status !== 'low')) return null;
  set({ via: 'session' });
  try {
    const outcome = await sendWithKey({
      accountId: cur.accountId,
      key: cur.key,
      receiverId: active.game,
      methodName: call.methodName,
      args: call.args,
      gas: call.gas,
    });
    void refresh();
    return outcome as unknown as WalletOutcome;
  } catch (error) {
    if (error instanceof SessionRejected) {
      await dropKey(
        error.message,
        `${error.message} Nothing was sent. This action now asks your wallet; enable the session key again afterwards.`,
      );
      return null;
    }
    throw error;
  }
}
