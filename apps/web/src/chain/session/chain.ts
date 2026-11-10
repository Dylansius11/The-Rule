import { config } from '@/config/env';
import type { OnChainKey } from './policy';

/**
 * Read one access key at optimistic finality so a key the wallet has just added is visible at once.
 * Returns null only when the chain says the key does not exist; any other failure throws.
 */
export async function viewAccessKey(accountId: string, publicKey: string): Promise<OnChainKey | null> {
  let last: unknown;
  for (const url of config.rpcUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'session-key',
          method: 'query',
          params: {
            request_type: 'view_access_key',
            finality: 'optimistic',
            account_id: accountId,
            public_key: publicKey,
          },
        }),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const body = await response.json();
      const text = JSON.stringify(body.error ?? '');
      if (body.error && /UNKNOWN_ACCESS_KEY|does not exist while viewing/i.test(text)) return null;
      if (body.error) throw new Error(`Access key view failed: ${text}`);
      const { nonce, permission } = body.result ?? {};
      if (nonce === undefined || permission === undefined) throw new Error('Invalid access key response');
      return { nonce, permission } as OnChainKey;
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error('RPC unavailable');
}
