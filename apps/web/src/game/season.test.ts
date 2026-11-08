import { describe, expect, it, vi } from 'vitest';
import {
  nextSeasonCursor,
  readSeasonPages,
  type SeasonCursor,
  type SeasonRow,
  type SeasonStatus,
} from './season';
import { getSeason } from '@/chain/views';
import { MethodNotFound, RpcError, view } from '@/chain/rpc';

import type * as RpcModule from '@/chain/rpc';
vi.mock('@/chain/rpc', async importOriginal => {
  const original = await importOriginal<typeof RpcModule>();
  return { ...original, view: vi.fn() };
});
const ready: SeasonStatus = { ready: true, indexed: 201, total: 201, revision: 2 };
const row = (id: number): SeasonRow => {
  const cursor: SeasonCursor = {
    entity_tag: 0,
    entity_id: id,
    rounds_won: 1,
    shares: 2,
    earliest_winning_block: 4,
  };
  return { ...cursor, earned: '100', cursor };
};

describe('HEAD season pages', () => {
  it('starts with null, follows the full last cursor and loads beyond 200 rows', async () => {
    const first = Array.from({ length: 200 }, (_, i) => row(i));
    const page = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([row(200)]);
    const result = await readSeasonPages(async () => ready, page);
    expect(page.mock.calls).toEqual([
      [null, 200],
      [first[199]!.cursor, 200],
    ]);
    expect(result).toMatchObject({ supported: true, ready: true });
    if (result.supported && result.ready) expect(result.rows).toHaveLength(201);
    expect(nextSeasonCursor([], 200)).toBeNull();
    expect(nextSeasonCursor([row(0)], 200)).toBeNull();
  });
  it('handles empty boards and exact page boundaries', async () => {
    const full = Array.from({ length: 200 }, (_, i) => row(i));
    const page = vi.fn().mockResolvedValueOnce(full).mockResolvedValueOnce([]);
    await readSeasonPages(async () => ready, page);
    expect(page).toHaveBeenCalledTimes(2);
    expect(
      await readSeasonPages(
        async () => ready,
        async () => [],
      ),
    ).toEqual({ supported: true, ready: true, rows: [] });
  });
  it('does not read rows while the index is rebuilding', async () => {
    const page = vi.fn();
    const status = { ...ready, ready: false, indexed: 20 };
    expect(await readSeasonPages(async () => status, page)).toEqual({
      supported: true,
      ready: false,
      status,
    });
    expect(page).not.toHaveBeenCalled();
  });
  it('discards a board when the index revision changes during pagination', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ ...ready, revision: 3 });
    expect(await readSeasonPages(status, async () => [row(0)])).toMatchObject({
      supported: true,
      ready: false,
    });
  });
  it('keeps MethodNotFound honest on r2 and surfaces E50 from a page race', async () => {
    vi.mocked(view).mockRejectedValueOnce(new MethodNotFound());
    expect(await getSeason(0, 0)).toEqual({ supported: false });
    const rebuilding = { ...ready, ready: false, indexed: 0 };
    vi.mocked(view)
      .mockResolvedValueOnce(ready)
      .mockRejectedValueOnce(new RpcError('Contract view failed', { error: 'E50' }))
      .mockResolvedValueOnce(rebuilding);
    expect(await getSeason(0, 0)).toEqual({ supported: true, ready: false, status: rebuilding });
  });
  it('does not hide unrelated view failures as unsupported', async () => {
    vi.mocked(view).mockRejectedValueOnce(new RpcError('offline'));
    await expect(getSeason(0, 0)).rejects.toThrow('offline');
  });
});
