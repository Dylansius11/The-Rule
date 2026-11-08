import { config, active } from '@/config/env';

export class RpcError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}
export class MethodNotFound extends RpcError {
  constructor(detail?: unknown) {
    super('Contract method not found', detail);
    this.name = 'MethodNotFound';
  }
}

export async function view<T>(method: string, args: object = {}, accountId = active.game): Promise<T> {
  let last: unknown;
  for (const url of config.rpcUrls) {
    try {
      const argsBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))));
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'the-rule',
          method: 'query',
          params: {
            request_type: 'call_function',
            finality: 'final',
            account_id: accountId,
            method_name: method,
            args_base64: argsBase64,
          },
        }),
      });
      if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) {
        const text = JSON.stringify(body.error);
        if (/MethodNotFound|method.*not found|does not have method/i.test(text))
          throw new MethodNotFound(body.error);
        throw new RpcError('Contract view failed', body.error);
      }
      if (body.result?.error) {
        const detail = body.result.error;
        if (/MethodNotFound|method.*not found|does not have method/i.test(detail))
          throw new MethodNotFound(detail);
        throw new RpcError('Contract view failed', detail);
      }
      return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
    } catch (error) {
      if (error instanceof MethodNotFound) throw error;
      last = error;
    }
  }
  throw last instanceof Error ? last : new RpcError('RPC unavailable', last);
}

export async function getFinalBlock(): Promise<{ height: number; timestampMs: number }> {
  let last: unknown;
  for (const url of config.rpcUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'the-rule',
          method: 'block',
          params: { finality: 'final' },
        }),
      });
      if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new RpcError('Block query failed', body.error);
      return {
        height: body.result.header.height,
        timestampMs: Number(BigInt(body.result.header.timestamp_nanosec) / 1_000_000n),
      };
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new RpcError('RPC unavailable', last);
}

/** Native account amount; storage collateral may reduce the amount available to spend. */
export async function getNearBalance(accountId: string): Promise<bigint> {
  let last: unknown;
  for (const url of config.rpcUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'the-rule',
          method: 'query',
          params: { request_type: 'view_account', finality: 'final', account_id: accountId },
        }),
      });
      if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new RpcError('Account view failed', body.error);
      if (typeof body.result?.amount !== 'string' || !/^\d+$/.test(body.result.amount)) {
        throw new RpcError('Invalid account balance response', body.result);
      }
      return BigInt(body.result.amount);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new RpcError('RPC unavailable', last);
}
