import { afterEach, expect, it, vi } from 'vitest';
import { config } from '@/config/env';
import { COOLDOWN_MS, getNearBalance, isRateLimited, isUnreachable, MethodNotFound, view } from './rpc';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('recognizes a missing contract method in query result errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { error: 'wasm execution failed with error: MethodResolveError(MethodNotFound)', logs: [] },
      }),
    }),
  );
  await expect(view('get_season')).rejects.toBeInstanceOf(MethodNotFound);
});

it('reads an exact native balance at finality', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { amount: '1234567890123456789012345' } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  expect(await getNearBalance('alice.testnet')).toBe(1234567890123456789012345n);
  const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
  expect(request.params).toEqual({
    request_type: 'view_account',
    finality: 'final',
    account_id: 'alice.testnet',
  });
});

const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });
const viewOk = (value: unknown) => ({
  result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) },
});
const [primary, fallback] = config.rpcUrls;

it('moves to the fallback endpoint when the primary rate-limits, then skips the primary during its cooldown', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
  const fetchMock = vi.fn(async (url: string) =>
    url === primary ? reply(429) : reply(200, viewOk({ n: 1 })),
  );
  vi.stubGlobal('fetch', fetchMock);

  expect(await view('get_params')).toEqual({ n: 1 });
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([primary, fallback]);

  fetchMock.mockClear();
  expect(await view('get_params')).toEqual({ n: 1 });
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([fallback]);

  vi.setSystemTime(Date.now() + COOLDOWN_MS + 1);
  fetchMock.mockClear();
  await view('get_params');
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([primary, fallback]);
});

it('reports a rate limit, and still retries every endpoint, when all of them are limiting', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
  const fetchMock = vi.fn(async () => reply(429));
  vi.stubGlobal('fetch', fetchMock);
  const failure = await view('get_params').catch((error: unknown) => error);
  expect(isRateLimited(failure)).toBe(true);
  fetchMock.mockClear();
  await view('get_params').catch(() => undefined);
  expect(fetchMock).toHaveBeenCalledTimes(config.rpcUrls.length);
});

it('does not treat an ordinary server error as a rate limit', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply(502)),
  );
  const failure = await view('get_params').catch((error: unknown) => error);
  expect(isRateLimited(failure)).toBe(false);
});

it('treats a reply the browser cannot read (a 429 without CORS headers) as an unreachable, cooling-down endpoint', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
  const blocked = new TypeError('Failed to fetch');
  const fetchMock = vi.fn(async (url: string) => {
    if (url === primary) throw blocked;
    return reply(200, viewOk({ n: 2 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  expect(await view('get_params')).toEqual({ n: 2 });
  fetchMock.mockClear();
  await view('get_params');
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([fallback]);

  vi.setSystemTime(new Date('2026-11-15T00:00:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(blocked)),
  );
  const failure = await view('get_params').catch((error: unknown) => error);
  expect(isUnreachable(failure)).toBe(true);
  expect(isRateLimited(failure)).toBe(false);
});
