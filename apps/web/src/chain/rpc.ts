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

/** The endpoint answered HTTP 429: it is up but is limiting this browser. */
export const isRateLimited = (error: unknown): boolean =>
  error instanceof RpcError && (error.detail as { status?: number } | undefined)?.status === 429;

/** The browser could not read any reply: offline, blocked, or a rate limit whose 429 carries no CORS headers. */
export const isUnreachable = (error: unknown): boolean =>
  error instanceof RpcError && (error.detail as { network?: boolean } | undefined)?.network === true;

/** The parts of a JSON-RPC reply this app reads. The wire shape is declared here, not validated field by field. */
interface RpcBody {
  error?: unknown;
  result?: {
    error?: string;
    result?: number[];
    amount?: unknown;
    header?: { height: number; timestamp_nanosec: string };
  };
}

/** How long a rate-limited endpoint is skipped while another one is available. */
export const COOLDOWN_MS = 15_000;
const coolUntil = new Map<string, number>();

/**
 * POST one JSON-RPC request to the configured endpoints in order and return `parse(body)` from the first that
 * answers. An endpoint that rate-limits or cannot be read is skipped for `COOLDOWN_MS` so the app does not keep
 * hammering it, but it is still tried when every endpoint is cooling down. A browser cannot read a 429 that
 * lacks CORS headers (FastNear's has none): `fetch` then rejects with a bare TypeError, so that counts as
 * "unreachable or limiting" too. A `parse` that throws `MethodNotFound` stops at once; any other parse
 * failure moves on to the next endpoint.
 */
async function call<T>(payload: object, parse: (body: RpcBody) => T): Promise<T> {
  const now = Date.now();
  const ready = config.rpcUrls.filter(url => (coolUntil.get(url) ?? 0) <= now);
  let last: unknown;
  for (const url of ready.length ? ready : config.rpcUrls) {
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        coolUntil.set(url, now + COOLDOWN_MS);
        throw new RpcError('RPC unreachable', { network: true });
      }
      if (response.status === 429) {
        coolUntil.set(url, now + COOLDOWN_MS);
        throw new RpcError('RPC rate limited', { status: 429 });
      }
      if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`, { status: response.status });
      return parse((await response.json()) as RpcBody);
    } catch (error) {
      if (error instanceof MethodNotFound) throw error;
      last = error;
    }
  }
  throw last instanceof Error ? last : new RpcError('RPC unavailable', last);
}

export function view<T>(method: string, args: object = {}, accountId = active.game): Promise<T> {
  const argsBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))));
  return call(
    {
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
    },
    body => {
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
      if (!body.result?.result) throw new RpcError('Invalid view response', body.result);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
    },
  );
}

export function getFinalBlock(): Promise<{ height: number; timestampMs: number }> {
  return call({ jsonrpc: '2.0', id: 'the-rule', method: 'block', params: { finality: 'final' } }, body => {
    if (body.error) throw new RpcError('Block query failed', body.error);
    const header = body.result?.header;
    if (!header) throw new RpcError('Invalid block response', body.result);
    return {
      height: header.height,
      timestampMs: Number(BigInt(header.timestamp_nanosec) / 1_000_000n),
    };
  });
}

/** Native account amount; storage collateral may reduce the amount available to spend. */
export function getNearBalance(accountId: string): Promise<bigint> {
  return call(
    {
      jsonrpc: '2.0',
      id: 'the-rule',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    },
    body => {
      if (body.error) throw new RpcError('Account view failed', body.error);
      const amount = body.result?.amount;
      if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
        throw new RpcError('Invalid account balance response', body.result);
      }
      return BigInt(amount);
    },
  );
}
