import { afterEach, expect, it, vi } from 'vitest';
import { getNearBalance, MethodNotFound, view } from './rpc';
afterEach(() => vi.unstubAllGlobals());
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
