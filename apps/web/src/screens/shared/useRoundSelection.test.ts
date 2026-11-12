import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { active } from '@/config/env';
import { decodeRound } from '@/chain/views';
import fixture from '@/verify/fixtures/solo-round-0.json';
import type { Mode, Round } from '@/game/types';
import { useRoundSelection } from './useRoundSelection';

const opened = (id: number, mode: Mode = 0): Round => ({ ...decodeRound(fixture.round), roundId: id, mode });
const sealed = (id: number): Round => ({ ...opened(id), phase: 'Investigation', rule: null, salt: null });

function selection({
  mode = 0,
  url = '/play/solo/verify',
  latest = sealed(100),
  discovered,
  explicit,
}: {
  mode?: Mode;
  url?: string;
  latest?: Round;
  discovered?: Round[];
  explicit?: Round | null;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['latestRound', mode, active.game], latest);
  const otherMode: Mode = mode === 0 ? 1 : 0;
  client.setQueryData(['latestRound', otherMode, active.game], opened(999, otherMode));
  client.setQueryData(['roundHistory', active.game, otherMode, 999, true], {
    rounds: [opened(999, otherMode)],
    failures: [],
    from: 970,
    to: 999,
    limited: true,
  });
  if (discovered) {
    client.setQueryData(['roundHistory', active.game, mode, latest.roundId, !!latest.rule], {
      rounds: discovered,
      failures: [],
      from: Math.max(0, latest.roundId - 29),
      to: latest.roundId,
      limited: latest.roundId > 29,
    });
  }
  if (explicit !== undefined) {
    const id = Number(new URL(url, 'http://local').searchParams.get('round'));
    client.setQueryData(['round', mode, id, active.game], explicit);
  }
  let result: { roundId: number | null; rounds: number[]; loading: boolean } | undefined;
  function Probe() {
    const selected = useRoundSelection(mode, 'revealed');
    result = { roundId: selected.roundId, rounds: selected.rounds, loading: selected.loading };
    return null;
  }
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, { initialEntries: [url] }, createElement(Probe)),
    ),
  );
  client.clear();
  return result!;
}

describe('historical round selection', () => {
  it('waits for discovery instead of flashing a sealed latest before the opened round', () => {
    expect(selection({})).toEqual({ roundId: null, rounds: [100], loading: true });
    expect(selection({ discovered: [sealed(100), opened(98)] })).toEqual({
      roundId: 98,
      rounds: [100, 98],
      loading: false,
    });
  });
  it('keeps explicit round zero selected outside the discovery window', () => {
    const result = selection({
      url: '/play/solo/verify?round=0',
      explicit: opened(0),
      discovered: [sealed(100), opened(98)],
    });
    expect(result).toEqual({ roundId: 0, rounds: [100, 98, 0], loading: false });
    expect(selection({ url: '/play/solo/verify?round=0', explicit: opened(0) }).roundId).toBe(0);
  });
  it('preserves the maximum u32 ID as an explicit historical selection', () => {
    const id = 4_294_967_295;
    expect(
      selection({
        url: `/play/solo/verify?round=${id}`,
        explicit: opened(id),
        latest: opened(0),
        discovered: [opened(0)],
      }),
    ).toEqual({ roundId: id, rounds: [id, 0], loading: false });
  });
  it('does not make an absent explicit round a selectable record', () => {
    expect(
      selection({
        url: '/play/solo/verify?round=11',
        explicit: null,
        latest: opened(12),
        discovered: [opened(12), opened(0)],
      }),
    ).toEqual({
      roundId: 11,
      rounds: [12, 0],
      loading: false,
    });
  });
  it('reads Team history independently of cached Solo records', () => {
    expect(selection({ mode: 1, latest: opened(0, 1), discovered: [opened(0, 1)] })).toEqual({
      roundId: 0,
      rounds: [0],
      loading: false,
    });
  });
  it.each(['4294967296', '9007199254740992', '-1', '1.5'])('rejects URL IDs outside u32: %s', id => {
    expect(
      selection({ url: `/play/solo/verify?round=${id}`, latest: opened(0), discovered: [opened(0)] }).roundId,
    ).toBe(0);
  });
});
