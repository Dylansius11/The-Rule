import type * as NearApi from 'near-api-js';
import { config } from '@/config/env';
import type { StoredKey } from './keystore';
import { loadNear, loadRpcErrors } from './near';
import { SessionRejected, type RejectionKind } from './policy';

type NearAccount = InstanceType<typeof NearApi.Account>;

/** Signs with a non-extractable WebCrypto Ed25519 key; the secret never leaves the browser's key store. */
export function createSigner(near: typeof NearApi, key: StoredKey) {
  const publicKey = near.PublicKey.from(key.publicKey);
  class CryptoKeySigner extends near.Signer {
    getPublicKey() {
      return Promise.resolve(publicKey);
    }
    protected async signBytes(bytes: Uint8Array) {
      return new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, new Uint8Array(bytes)));
    }
  }
  return new CryptoKeySigner();
}

/** One Account per key keeps its nonce counter, so quick consecutive calls get distinct nonces. */
const accounts = new Map<string, Promise<NearAccount>>();
const accountKey = (accountId: string, key: StoredKey) => `${accountId}|${key.publicKey}`;

function accountFor(accountId: string, key: StoredKey): Promise<NearAccount> {
  const id = accountKey(accountId, key);
  let entry = accounts.get(id);
  if (!entry) {
    entry = (async () => {
      const near = await loadNear();
      const provider = new near.FailoverRpcProvider(
        config.rpcUrls.map(url => new near.JsonRpcProvider({ url })),
      );
      return new near.Account(accountId, provider, createSigner(near, key));
    })();
    accounts.set(id, entry);
    // A failed setup must not be cached forever.
    entry.catch(() => accounts.delete(id));
  }
  return entry;
}

export function forgetAccount(accountId: string, key: StoredKey) {
  accounts.delete(accountKey(accountId, key));
}

/**
 * Map a failure to a definitive "the network rejected the key before running anything" kind.
 * Failover wraps one error per RPC node; a timeout on any of them means the transaction may have
 * landed, so only a list where EVERY entry is a definitive rejection counts.
 */
export async function classifyRejection(error: unknown): Promise<RejectionKind | null> {
  const rpc = await loadRpcErrors();
  const kindOf = (e: unknown): RejectionKind | null => {
    if (e instanceof rpc.AccessKeyNotFoundActionError || e instanceof rpc.AccessKeyDoesNotExistError) {
      return 'key-missing';
    }
    if (e instanceof rpc.AccessKeyNotEnoughAllowanceActionError) return 'allowance';
    if (e instanceof rpc.InvalidNonceError) return 'nonce';
    if (
      e instanceof rpc.AccessKeyMethodNameMismatchActionError ||
      e instanceof rpc.AccessKeyReceiverMismatchActionError ||
      e instanceof rpc.AccessKeyDepositWithFunctionCallActionError ||
      e instanceof rpc.AccessKeyRequiresFullAccessActionError ||
      e instanceof rpc.InvalidSignatureError
    ) {
      return 'invalid-key';
    }
    return null;
  };
  const wrapped = (error as { errors?: unknown } | null)?.errors;
  const list = Array.isArray(wrapped) ? wrapped : [error];
  const kinds = list.map(kindOf);
  return list.length > 0 && kinds.every(k => k !== null) ? kinds[0]! : null;
}

export interface KeyCall {
  accountId: string;
  key: StoredKey;
  receiverId: string;
  methodName: string;
  args: object;
  gas: bigint;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const RESULT_DEADLINE_MS = 90_000;

/**
 * The game answers a play with its own receipt and detaches the OutLayer request, so waiting for every
 * descendant receipt would block until the enclave replies. Like the wallet path, report the status of
 * the root call's receipt once it is final; the contract views carry the verdict.
 */
async function rootResult(
  account: NearAccount,
  accountId: string,
  sent: Awaited<ReturnType<NearAccount['signAndSendTransaction']>>,
) {
  const deadline = Date.now() + RESULT_DEADLINE_MS;
  let observed = sent;
  for (;;) {
    const receiptId = observed.transaction_outcome?.outcome.receipt_ids[0];
    const receipt = observed.receipts_outcome?.find(item => item.id === receiptId);
    const status = receipt?.outcome.status;
    if (receipt && typeof status === 'object' && ('SuccessValue' in status || 'Failure' in status)) {
      const [receiptBlock, finalBlock] = await Promise.all([
        account.provider.viewBlock({ blockId: receipt.block_hash }),
        account.provider.viewBlock({ finality: 'final' }),
      ]);
      if (finalBlock.header.height >= receiptBlock.header.height) return { ...observed, status };
    }
    if (Date.now() > deadline) {
      throw new Error(
        'The transaction was sent but its result did not arrive in time. Check the ledger before trying again.',
      );
    }
    await sleep(500);
    observed = await account.provider.viewTransactionStatusWithReceipts({
      txHash: sent.transaction.hash,
      accountId,
      waitUntil: 'INCLUDED_FINAL',
    });
  }
}

/**
 * Sign locally and broadcast once. No library retry: a rejected key throws SessionRejected, anything
 * else (network, timeout, contract failure) propagates untouched and is never retried or redirected.
 * Only the broadcast can raise SessionRejected; once the transaction is in, errors are ambiguous.
 */
export async function sendWithKey(call: KeyCall) {
  const near = await loadNear();
  const account = await accountFor(call.accountId, call.key);
  let sent;
  try {
    sent = await account.signAndSendTransaction({
      receiverId: call.receiverId,
      actions: [
        near.actions.functionCall(call.methodName, call.args as Record<string, unknown>, call.gas, 0n),
      ],
      waitUntil: 'INCLUDED_FINAL',
      throwOnFailure: false,
      retries: 0,
    });
  } catch (error) {
    const kind = await classifyRejection(error);
    if (kind) {
      forgetAccount(call.accountId, call.key);
      throw new SessionRejected(kind, error);
    }
    throw error;
  }
  return rootResult(account, call.accountId, sent);
}
