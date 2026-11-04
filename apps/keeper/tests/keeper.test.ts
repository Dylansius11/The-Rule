import { describe, expect, it, vi } from 'vitest';
import { KeyPair } from 'near-api-js';
import { decide, type Params, type Round, type NextSlot } from '../src/game.ts';
import { run } from '../src/keeper.ts';

const params: Params = { genesis_ns: 100, round_period_ns: 100, mode_offset_ns: [0, 20], investigation_max_ns: 20, reveal_window_ns: 10, begin_timeout_ns: 30, open_timeout_ns: 40 };
const round: Round = { mode: 0, round_id: 0, phase: 'Investigation', slot_ns: 100, sealing_started_ns: 100, begin_status: 'ok', investigation_end_ns: 120, freeze_ns: null, reveal_deadline_ns: 150, pending_checks: 0, opening_started_ns: 150, open_status: 'pending', pot: '0', log_len: 0 };
const slots: [NextSlot, NextSlot] = [{ round_id: 1, slot_ns: 200 }, { round_id: 1, slot_ns: 220 }];
const methods = (rounds: Round[], now: number, next = slots) => decide(params, rounds, next, BigInt(now)).map(d => `${d.args.mode}:${d.method}${d.args.round_id === undefined ? '' : ':' + d.args.round_id}`);

describe('lifecycle', () => {
  it('starts each mode at its exact next slot, including a missed slot', () => {
    expect(methods([], 199)).toEqual([]);
    expect(methods([], 200)).toEqual(['0:start_round']);
    expect(methods([], 219)).toEqual(['0:start_round']);
    expect(methods([], 220)).toEqual(['0:start_round', '1:start_round']);
    expect(methods([], 500)).toEqual(['0:start_round', '1:start_round']);
  });
  it('uses actual sealing, investigation and opening times and checks each boundary', () => {
    const sealing: Round = { ...round, phase: 'Sealing', sealing_started_ns: 120, begin_status: 'pending' };
    expect(methods([sealing], 149)).toEqual([]);
    expect(methods([{ ...sealing, begin_status: 'failed' }], 149)).toEqual(['0:start_round']);
    expect(methods([sealing], 150)).toEqual(['0:cancel:0']);
    expect(methods([round], 119)).toEqual([]);
    expect(methods([round], 120)).toEqual(['0:advance']);
    const reveal: Round = { ...round, phase: 'Reveal' };
    expect(methods([reveal], 149)).toEqual([]);
    expect(methods([{ ...reveal, pending_checks: 1 }], 150)).toEqual([]);
    expect(methods([reveal], 150)).toEqual(['0:finalize']);
    const opening: Round = { ...round, phase: 'Opening' };
    expect(methods([opening], 189)).toEqual([]);
    expect(methods([{ ...opening, open_status: 'failed' }], 189)).toEqual(['0:retry_open:0']);
    expect(methods([opening], 190)).toEqual(['0:cancel:0']);
    expect(() => methods([{ ...opening, opening_started_ns: null }], 160)).toThrow();
    expect(methods([{ ...round, phase: 'Scheduled' }], 200)).toEqual([]);
  });
  it('tracks an older Opening alongside a new active round without losing either', () => {
    const older: Round = { ...round, phase: 'Opening', round_id: 0, opening_started_ns: 180, open_status: 'failed' };
    const newer: Round = { ...round, round_id: 1, phase: 'Investigation', investigation_end_ns: 210 };
    expect(methods([older, newer], 210)).toEqual(['0:retry_open:0', '0:advance']);
    expect(methods([older], 210)).toEqual(['0:retry_open:0', '0:start_round']);
    expect(methods([{ ...older, mode: 1 }, { ...newer, mode: 1 }], 210)).toEqual(['1:retry_open:0', '1:advance', '0:start_round']);
  });
});

function mockRpc(mode: 'none' | 'success' | 'failure' | 'duplicate' | 'not-final', options: { rounds?: Round[]; slot?: NextSlot } = {}) {
  const calls: string[] = [];
  const key = KeyPair.fromRandom('ed25519').toString();
  const ping = 'https://private-heartbeat.invalid/token';
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === ping) { calls.push('ping'); return new Response('ok'); }
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: { request_type?: string; method_name?: string; finality?: string } };
    calls.push(request.method === 'query' ? request.params.request_type + ':' + (request.params.method_name ?? '') : request.method);
    let result: unknown;
    if (request.method === 'block') result = { header: { hash: '11111111111111111111111111111111', height: 1, timestamp_nanosec: '120' } };
    else if (request.method === 'query' && request.params.request_type === 'view_access_key') result = { nonce: 1, permission: 'FullAccess', block_hash: '11111111111111111111111111111111', block_height: 1 };
    else if (request.method === 'query' && request.params.method_name) {
      if (request.params.finality !== 'final') throw new Error('Views must be final');
      const value = request.params.method_name === 'get_params' ? params : request.params.method_name === 'get_active_rounds' ? options.rounds ?? [{ ...round, investigation_end_ns: mode === 'none' ? 130 : 120 }] : request.params.method_name === 'get_next_slot' ? options.slot ?? { round_id: 1, slot_ns: 300 } : round;
      result = { result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [] };
    } else if (request.method === 'send_tx') {
      result = { final_execution_status: mode === 'not-final' ? 'EXECUTED' : 'FINAL', status: mode === 'success' ? { SuccessValue: '' } : { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: mode === 'duplicate' ? 'E10' : 'E22' } } } } } };
    } else throw new Error('Unexpected RPC ' + request.method);
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  return { calls, fetcher, config: { NEAR_RPC_URL: 'https://rpc.invalid', GAME_ACCOUNT: 'game.testnet', KEEPER_ACCOUNT: 'keeper.testnet', KEEPER_PRIVATE_KEY: key, HEALTHCHECK_PING_URL: ping } };
}

describe('RPC keeper', () => {
  it('reads both round and next-slot views and pings only after successful final views', async () => {
    const m = mockRpc('none'); await run(m.config, false, () => {}, m.fetcher as typeof fetch);
    expect(m.calls.filter(x => x === 'call_function:get_round')).toHaveLength(2);
    expect(m.calls.filter(x => x === 'call_function:get_next_slot')).toHaveLength(2);
    expect(m.calls).toContain('call_function:get_active_rounds');
    expect(m.calls.at(-1)).toBe('ping');
  });
  it('uses mock RPC to decide an overlapping opening and investigation', async () => {
    const older: Round = { ...round, phase: 'Opening', opening_started_ns: 100, open_status: 'failed' };
    const newer: Round = { ...round, round_id: 1 };
    const m = mockRpc('none', { rounds: [older, newer] });
    const logs: string[] = [];
    await run(m.config, true, message => logs.push(message), m.fetcher as typeof fetch);
    expect(logs).toEqual(['mode=0 decision=retry_open', 'mode=0 decision=advance']);
  });
  it('uses mock RPC to start both missed slots', async () => {
    const m = mockRpc('none', { rounds: [], slot: { round_id: 2, slot_ns: 100 } });
    const logs: string[] = [];
    await run(m.config, true, message => logs.push(message), m.fetcher as typeof fetch);
    expect(logs).toEqual(['mode=0 decision=start_round', 'mode=1 decision=start_round']);
  });
  it('decides each lifecycle state through the mock RPC', async () => {
    const cases: [Round, string][] = [
      [{ ...round, phase: 'Scheduled' }, 'decision=none'],
      [{ ...round, phase: 'Sealing', sealing_started_ns: 100, begin_status: 'pending' }, 'decision=none'],
      [{ ...round, phase: 'Sealing', sealing_started_ns: 100, begin_status: 'failed' }, 'mode=0 decision=start_round'],
      [{ ...round, phase: 'Sealing', sealing_started_ns: 90, begin_status: 'pending' }, 'mode=0 decision=cancel'],
      [round, 'mode=0 decision=advance'],
      [{ ...round, phase: 'Reveal', reveal_deadline_ns: 120 }, 'mode=0 decision=finalize'],
      [{ ...round, phase: 'Reveal', reveal_deadline_ns: 120, pending_checks: 1 }, 'decision=none'],
      [{ ...round, phase: 'Opening', opening_started_ns: 100, open_status: 'failed' }, 'mode=0 decision=retry_open'],
      [{ ...round, phase: 'Opening', opening_started_ns: 80, open_status: 'pending' }, 'mode=0 decision=cancel'],
      [{ ...round, mode: 1 }, 'mode=1 decision=advance'],
    ];
    for (const [state, expected] of cases) {
      const m = mockRpc('none', { rounds: [state] });
      const logs: string[] = [];
      await run(m.config, true, message => logs.push(message), m.fetcher as typeof fetch);
      expect(logs).toEqual([expected]);
    }
  });
  it('does not sign or ping in dry run', async () => {
    const m = mockRpc('success'); await run(m.config, true, () => {}, m.fetcher as typeof fetch);
    expect(m.calls).not.toContain('send_tx'); expect(m.calls).not.toContain('ping');
  });
  for (const mode of ['success', 'failure', 'duplicate', 'not-final'] as const) it(`handles ${mode} transaction without exposing secrets`, async () => {
    const m = mockRpc(mode); const logs: string[] = []; vi.stubGlobal('fetch', m.fetcher);
    try {
      if (mode === 'failure' || mode === 'not-final') await expect(run(m.config, false, x => logs.push(x), m.fetcher as typeof fetch)).rejects.toThrow();
      else await run(m.config, false, x => logs.push(x), m.fetcher as typeof fetch);
      expect(m.calls).toContain('send_tx');
      expect(m.calls.includes('ping')).toBe(mode === 'success');
      if (mode === 'success') expect(m.calls.lastIndexOf('send_tx')).toBeLessThan(m.calls.indexOf('ping'));
      if (mode === 'duplicate') expect(m.calls.filter(x => x === 'call_function:get_round')).toHaveLength(3);
      expect(logs.join('\n')).not.toContain(m.config.KEEPER_PRIVATE_KEY);
      expect(logs.join('\n')).not.toContain(m.config.HEALTHCHECK_PING_URL);
    } finally { vi.unstubAllGlobals(); }
  });
});
