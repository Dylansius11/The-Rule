import { describe, expect, it } from 'vitest';
import { KeyPair, baseEncode, decodeSignedTransaction, encodeTransaction } from 'near-api-js';
import { decide, type NextSlot, type Params, type Round } from '../src/game.ts';
import { run } from '../src/keeper.ts';

const params: Params = { genesis_ns: 100, round_period_ns: 100, mode_offset_ns: [0, 20], investigation_max_ns: 20, reveal_window_ns: 10, begin_timeout_ns: 30, open_timeout_ns: 40 };
const round: Round = { mode: 0, round_id: 0, phase: 'Investigation', slot_ns: 100, sealing_started_ns: 100, begin_status: 'ok', investigation_end_ns: 120, freeze_ns: null, reveal_deadline_ns: 150, pending_checks: 0, opening_started_ns: 150, open_status: 'pending', pot: '0', log_len: 0 };
const slots: [NextSlot, NextSlot] = [{ round_id: 1, slot_ns: 300 }, { round_id: 0, slot_ns: 300 }];
const methods = (rounds: Round[], now: bigint) => decide(params, rounds, slots, now).map(d => d.method);

describe('lifecycle decisions', () => {
  it('uses exact boundaries and never cancels pending requests', () => {
    const sealing: Round = { ...round, phase: 'Sealing', begin_status: 'pending' };
    const opening: Round = { ...round, phase: 'Opening', open_status: 'pending' };
    expect(methods([sealing], 1000n)).toEqual(['start_round']); // the other mode is due
    expect(methods([{ ...sealing, begin_status: 'failed' }], 129n)).toEqual(['start_round']);
    expect(methods([{ ...sealing, begin_status: 'failed' }], 130n)).toEqual(['cancel']);
    expect(methods([round], 119n)).toEqual([]);
    expect(methods([round], 120n)).toEqual(['advance']);
    expect(methods([{ ...round, phase: 'Reveal', pending_checks: 1 }], 150n)).toEqual([]);
    expect(methods([{ ...round, phase: 'Reveal' }], 150n)).toEqual(['finalize']);
    expect(methods([opening], 190n)).toEqual([]);
    expect(methods([{ ...opening, open_status: 'failed' }], 189n)).toEqual(['retry_open']);
    expect(methods([{ ...opening, open_status: 'failed' }], 190n)).toEqual(['cancel']);
  });
  it('rejects out-of-range and malformed values rather than rounding', () => {
    for (const bad of ['18446744073709551616', '-1', '1.5', '01', Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => decide({ ...params, open_timeout_ns: bad }, [], slots, 100n)).toThrow();
    }
    expect(() => methods([{ ...round, round_id: 4294967296 }], 100n)).toThrow();
    expect(() => methods([{ ...round, pot: '340282366920938463463374607431768211456' }], 100n)).toThrow();
    expect(() => methods([round, round], 100n)).toThrow();
    expect(methods([{ ...round, investigation_end_ns: '18446744073709551615' }], 18446744073709551614n)).toEqual(['start_round']);
  });
});

type Outcome = 'success' | 'failure' | 'race' | 'not-final' | 'descendant' | 'missing' | 'unknown' | 'sweep' | 'gas-receipt';
function harness(options: { outcome?: Outcome; rounds?: Round[]; after?: Round[]; beforeSend?: Round[]; chain?: string; timestamp?: string; raceCode?: string; seasonBefore?: { ready: boolean; total: number; indexed: number; revision: string }; seasonAfter?: { ready: boolean; total: number; indexed: number; revision: string } } = {}) {
  let active = options.rounds ?? [round];
  let snapshots = 0;
  let season = options.seasonBefore;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const hash = '11111111111111111111111111111111';
  const config = { NEAR_RPC_URL: 'https://rpc.invalid', GAME_ACCOUNT: 'game.testnet', KEEPER_ACCOUNT: 'keeper.testnet', KEEPER_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(), HEALTHCHECK_PING_URL: 'https://heartbeat.invalid/private' };
  const transport: typeof fetch = async (input, init) => {
    if (String(input) === config.HEALTHCHECK_PING_URL) { calls.push({ method: 'ping', params: {} }); return new Response('ok'); }
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    calls.push(request);
    let result: unknown;
    if (request.method === 'status') result = { chain_id: options.chain ?? 'testnet' };
    else if (request.method === 'block') {
      if (++snapshots === 2 && options.beforeSend) active = options.beforeSend;
      result = { header: { hash, timestamp_nanosec: options.timestamp ?? '120' } };
    }
    else if (request.method === 'query' && request.params.request_type === 'view_access_key') result = { nonce: 1, permission: 'FullAccess', block_hash: hash, block_height: 1 };
    else if (request.method === 'query' && request.params.request_type === 'call_function') {
      const args = JSON.parse(atob(String(request.params.args_base64))) as { mode?: number; id?: number; season?: number };
      const value = request.params.method_name === 'get_params' ? params : request.params.method_name === 'get_active_rounds' ? active.filter(r => !['Settled', 'Cancelled', 'Void'].includes(r.phase)) : request.params.method_name === 'get_next_slot' ? slots[args.mode!] : request.params.method_name === 'get_season_status' ? (args.mode === 0 && args.season === 1 && season ? season : { ready: true, total: 0, indexed: 0, revision: '0' }) : active.filter(r => r.mode === args.mode && (args.id === undefined || r.round_id === args.id)).sort((a, b) => b.round_id - a.round_id)[0] ?? null;
      const json = JSON.stringify(value).replace(/"(\d{16,})"/g, '$1');
      result = { result: [...new TextEncoder().encode(json)], logs: [] };
    } else if (request.method === 'send_tx') {
      if (options.outcome === 'unknown') throw new Error('private key or endpoint');
      const status = options.outcome === 'failure' || options.outcome === 'race' ? { Failure: options.outcome === 'race' ? options.raceCode ?? 'E10' : 'E22' } : { SuccessValue: options.outcome === 'sweep' ? 'bnVsbA==' : '' };
      result = { final_execution_status: options.outcome === 'not-final' ? 'EXECUTED' : 'FINAL', status, transaction_outcome: { id: 'tx', outcome: { status: { SuccessReceiptId: 'a' }, receipt_ids: ['a'] } }, receipts_outcome: options.outcome === 'missing' ? [] : [{ id: 'a', outcome: { status: options.outcome === 'descendant' ? { Failure: 'callback failed' } : { SuccessValue: '' }, receipt_ids: options.outcome === 'gas-receipt' ? ['refund-without-outcome'] : [] } }] };
      if (options.seasonAfter) season = options.seasonAfter;
      if (options.after) active = options.after;
    } else throw new Error('Unexpected request');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }).replace(/"timestamp_nanosec":"(\d{16,})"/, '"timestamp_nanosec":$1'), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, config, transport };
}

describe('keeper execution', () => {
  it('pins all decision views to one actual final block and dry run never signs or pings', async () => {
    const h = harness({ timestamp: '9007199254740993', rounds: [{ ...round, investigation_end_ns: '9007199254740994' }] });
    const logs: string[] = [];
    await run(h.config, true, s => logs.push(s), h.transport);
    const views = h.calls.filter(c => c.params.request_type === 'call_function');
    expect(views.length).toBeGreaterThan(0);
    expect(views.every(c => c.params.block_id === '11111111111111111111111111111111' && !('finality' in c.params))).toBe(true);
    expect(logs).not.toContain('mode=0 round=0 decision=advance');
    expect(h.calls.some(c => c.method === 'send_tx' || c.method === 'ping')).toBe(false);
  });
  it('refuses wrong chain before signing and requires heartbeat outside dry run', async () => {
    const h = harness({ chain: 'mainnet' });
    await expect(run(h.config, false, () => {}, h.transport)).rejects.toThrow();
    expect(h.calls.some(c => c.method === 'send_tx' || c.method === 'ping')).toBe(false);
    const missing = { ...h.config, HEALTHCHECK_PING_URL: undefined };
    await expect(run(missing, false, () => {}, h.transport)).rejects.toThrow();
  });
  it('requires sandbox chain identity and a loopback endpoint', async () => {
    for (const chain of ['localnet', 'sandbox', 'test-chain-ilxKU']) {
      const h = harness({ chain, rounds: [{ ...round, investigation_end_ns: 121 }] });
      await run({ ...h.config, NEAR_NETWORK: 'sandbox', NEAR_RPC_URL: 'http://127.0.0.1:3030' }, true, () => {}, h.transport);
      await expect(run({ ...h.config, NEAR_NETWORK: 'sandbox' }, true, () => {}, h.transport)).rejects.toThrow();
    }
    for (const chain of ['mainnet', 'testnet', 'test-chain-', 'mainnet-test-chain-ilxKU']) {
      const wrong = harness({ chain });
      await expect(run({ ...wrong.config, NEAR_NETWORK: 'sandbox', NEAR_RPC_URL: 'http://127.0.0.1:3030' }, true, () => {}, wrong.transport)).rejects.toThrow();
      expect(wrong.calls.some(c => c.method === 'send_tx' || c.method === 'ping')).toBe(false);
    }
  });
  it('allows idle heartbeat only after successful final state observation', async () => {
    const h = harness({ rounds: [{ ...round, investigation_end_ns: 121 }] });
    await run(h.config, false, () => {}, h.transport);
    expect(h.calls.at(-1)?.method).toBe('ping');
    expect(h.calls.some(c => c.method === 'send_tx')).toBe(false);
  });
  it('signs a due transition once and checks post-state before heartbeat', async () => {
    const h = harness({ outcome: 'success', after: [{ ...round, phase: 'Reveal' }] });
    await run(h.config, false, () => {}, h.transport);
    expect(h.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(h.calls.at(-1)?.method).toBe('ping');
    expect(h.calls.findIndex(c => c.params.method_name === 'get_round')).toBeGreaterThan(h.calls.findIndex(c => c.method === 'send_tx'));
  });
  for (const outcome of ['failure', 'not-final', 'descendant', 'missing', 'unknown'] as const) it(`suppresses heartbeat for ${outcome}`, async () => {
    const h = harness({ outcome }); const logs: string[] = []; const beforeSend: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      if (JSON.parse(String(init?.body)).method === 'send_tx') beforeSend.push(...logs);
      return h.transport(input, init);
    };
    await expect(run(h.config, false, s => logs.push(s), transport)).rejects.toThrow('Keeper run failed');
    expect(h.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(h.calls.some(c => c.method === 'ping')).toBe(false);
    expect(logs.join()).not.toContain(h.config.KEEPER_PRIVATE_KEY);
    expect(logs.join()).not.toContain(h.config.HEALTHCHECK_PING_URL);
    if (outcome === 'unknown') {
      const send = h.calls.find(c => c.method === 'send_tx')!;
      const signed = decodeSignedTransaction(Buffer.from(String(send.params.signed_tx_base64), 'base64'));
      const hash = baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encodeTransaction(signed.transaction) as BufferSource)));
      expect(beforeSend).toContain(`transaction=${hash} signer=${signed.transaction.signerId} nonce=${signed.transaction.nonce} method=advance`);
      expect(logs.some(line => line.includes('stage=send rpc=send_tx rpc_failure=transport'))).toBe(true);
      expect(logs.join()).not.toContain('private key or endpoint');
    }
  });
  for (const raceCode of ['E10', 'E50']) it(`does not resubmit or ping on an ${raceCode} race`, async () => {
    const h = harness({ outcome: 'race', raceCode });
    await run(h.config, false, () => {}, h.transport);
    expect(h.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(h.calls.some(c => c.method === 'ping')).toBe(false);
  });
  it('rechecks a newer round after completing an older opening', async () => {
    const older: Round = { ...round, phase: 'Opening', open_status: 'failed', opening_started_ns: 100 };
    const newer: Round = { ...round, round_id: 1 };
    const h = harness({ rounds: [older, newer], after: [{ ...older, phase: 'Settled', open_status: 'ok' }, { ...newer, phase: 'Reveal' }] });
    await run(h.config, false, () => {}, h.transport);
    expect(h.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(h.calls.some(c => c.method === 'ping')).toBe(false);
  });
  it('treats detached pending callbacks as waiting, not success', async () => {
    const h = harness({ rounds: [{ ...round, phase: 'Sealing', begin_status: 'failed' }], after: [{ ...round, phase: 'Sealing', begin_status: 'pending' }] });
    await run(h.config, false, () => {}, h.transport);
    expect(h.calls.some(c => c.method === 'ping')).toBe(false);
  });
  it('suppresses heartbeat when a begin callback failed again', async () => {
    const failed: Round = { ...round, phase: 'Sealing', begin_status: 'failed' };
    const h = harness({ rounds: [failed], after: [failed] });
    await run({ ...h.config, KEEPER_MODES: '0' }, false, () => {}, h.transport);
    expect(h.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(h.calls.some(c => c.method === 'ping')).toBe(false);
  });
  it('recognizes a successful late begin already in Reveal', async () => {
    const failed: Round = { ...round, phase: 'Sealing', begin_status: 'failed' };
    const h = harness({ rounds: [failed], after: [{ ...round, phase: 'Reveal', begin_status: 'ok' }] });
    await run({ ...h.config, KEEPER_MODES: '0' }, false, () => {}, h.transport);
    expect(h.calls.at(-1)?.method).toBe('ping');
  });
  it('accepts a null finalize sweep without claiming the round opened', async () => {
    const reveal: Round = { ...round, phase: 'Reveal', reveal_deadline_ns: 120 };
    const h = harness({ rounds: [reveal], after: [reveal], outcome: 'sweep' }); const logs: string[] = [];
    await run(h.config, false, s => logs.push(s), h.transport);
    expect(logs).toContain('mode=0 postcondition=sweep');
    expect(h.calls.at(-1)?.method).toBe('ping');
  });
  it('indexes one bounded partial batch only when season maintenance is enabled', async () => {
    const before = { ready: false, total: 50, indexed: 0, revision: '9007199254740993' };
    const after = { ...before, indexed: 20 };
    const h = harness({ rounds: [{ ...round, round_id: 7, investigation_end_ns: 121 }], seasonBefore: before, seasonAfter: after });
    const logs: string[] = [];
    await run({ ...h.config, MAINTAIN_SEASONS: 'true' }, false, s => logs.push(s), h.transport);
    expect(h.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(logs).toContain('mode=0 season=1 postcondition=partial');
    expect(h.calls.at(-1)?.method).toBe('ping');
  });
  it('does not ping when a concurrent season revision invalidates the batch', async () => {
    const before = { ready: false, total: 50, indexed: 0, revision: '9007199254740993' };
    const h = harness({ rounds: [{ ...round, round_id: 7, investigation_end_ns: 121 }], seasonBefore: before, seasonAfter: { ...before, indexed: 20, revision: '9007199254740994' } });
    await run({ ...h.config, MAINTAIN_SEASONS: 'true' }, false, () => {}, h.transport);
    expect(h.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(h.calls.some(c => c.method === 'ping')).toBe(false);
  });
  it('fences mode and actual round before signing, including missed slots', async () => {
    const h = harness({ rounds: [], timestamp: '300' });
    const logs: string[] = [];
    await run({ ...h.config, KEEPER_MODES: '0', LAST_ROUND_ID: '0' }, true, s => logs.push(s), h.transport);
    expect(logs).toEqual(['decision=none']);
    await run({ ...h.config, KEEPER_MODES: '1', LAST_ROUND_ID: '0' }, true, s => logs.push(s), h.transport);
    expect(logs).toContain('mode=1 round=0 decision=start_round');
    const due = harness({ rounds: [round], after: [{ ...round, phase: 'Reveal' }] });
    await run({ ...due.config, KEEPER_MODES: '0', LAST_ROUND_ID: '0' }, false, () => {}, due.transport);
    expect(due.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
  });
  it('does not sign below an explicit lower fence and admits the exact lower boundary', async () => {
    const excluded = harness({ rounds: [round], after: [{ ...round, phase: 'Reveal' }] });
    await run({ ...excluded.config, KEEPER_MODES: '0', FIRST_ROUND_ID: '1', LAST_ROUND_ID: '1' }, false, () => {}, excluded.transport);
    expect(excluded.calls.some(c => c.method === 'send_tx')).toBe(false);
    const admitted = harness({ rounds: [{ ...round, round_id: 1 }], after: [{ ...round, round_id: 1, phase: 'Reveal' }] });
    await run({ ...admitted.config, KEEPER_MODES: '0', FIRST_ROUND_ID: '1', LAST_ROUND_ID: '1' }, false, () => {}, admitted.transport);
    expect(admitted.calls.filter(c => c.method === 'send_tx')).toHaveLength(1);
    expect(admitted.calls.at(-1)?.method).toBe('ping');
  });
  it('does not let an out-of-scope pending round suppress an authorized idle heartbeat', async () => {
    const older = { ...round, phase: 'Opening' as const, open_status: 'pending' as const };
    const current = { ...round, round_id: 1, investigation_end_ns: 121 };
    const h = harness({ rounds: [older, current] });
    await run({ ...h.config, KEEPER_MODES: '0', FIRST_ROUND_ID: '1', LAST_ROUND_ID: '1' }, false, () => {}, h.transport);
    expect(h.calls.some(c => c.method === 'send_tx')).toBe(false);
    expect(h.calls.at(-1)?.method).toBe('ping');
  });
  it('rejects malformed fences and omits unselected or unauthorized season targets', async () => {
    const h = harness({ rounds: [{ ...round, round_id: 7, investigation_end_ns: 121 }], seasonBefore: { ready: false, total: 50, indexed: 0, revision: '1' } });
    for (const fence of [{ KEEPER_MODES: '1,0' }, { LAST_ROUND_ID: '4294967296' }, { LAST_ROUND_ID: '-1' }, { FIRST_ROUND_ID: '4294967296' }, { FIRST_ROUND_ID: '-1' }, { FIRST_ROUND_ID: '2', LAST_ROUND_ID: '1' }]) {
      await expect(run({ ...h.config, ...fence }, true, () => {}, h.transport)).rejects.toThrow();
    }
    await run({ ...h.config, KEEPER_MODES: '0', LAST_ROUND_ID: '0', MAINTAIN_SEASONS: 'true' }, false, () => {}, h.transport);
    expect(h.calls.some(c => c.method === 'send_tx')).toBe(false);
    const queries = h.calls.filter(c => c.params.method_name === 'get_season_status');
    expect(queries.every(c => {
      const args = JSON.parse(atob(String(c.params.args_base64))) as { mode: number; season: number };
      return args.mode === 0 && args.season === 0;
    })).toBe(true);
  });
  it('allows a historical opening below the fence but not the newer current round', async () => {
    const older: Round = { ...round, round_id: 2, phase: 'Opening', open_status: 'failed', opening_started_ns: 100 };
    const newer: Round = { ...round, round_id: 3 };
    const h = harness({ rounds: [older, newer], timestamp: '120' });
    const logs: string[] = [];
    await run({ ...h.config, KEEPER_MODES: '0', LAST_ROUND_ID: '2' }, true, message => logs.push(message), h.transport);
    expect(logs).toEqual(['mode=0 round=2 decision=retry_open']);
  });
  it('scopes overlapping openings and all current calls to their exact round', () => {
    const opening = { ...round, round_id: 2, phase: 'Opening' as const, open_status: 'failed' as const };
    const current = { ...round, round_id: 3 };
    expect(decide(params, [opening, current], slots, 180n)).toEqual([
      { method: 'retry_open', args: { mode: 0, round_id: 2 } },
      { method: 'advance', args: { mode: 0, round_id: 3 } },
    ]);
    expect(decide(params, [], slots, 300n)).toEqual([
      { method: 'start_round', args: { mode: 0, round_id: 1 } },
      { method: 'start_round', args: { mode: 1, round_id: 0 } },
    ]);
  });
  it('does not send a stale decision when the round changes before signing', async () => {
    const h = harness({ beforeSend: [{ ...round, round_id: 1 }] });
    await run({ ...h.config, KEEPER_MODES: '0', LAST_ROUND_ID: '0' }, false, () => {}, h.transport);
    expect(h.calls.some(c => c.method === 'send_tx' || c.method === 'ping')).toBe(false);
  });
  it('accepts a gas or data receipt id without a separate outcome, after checking post-state', async () => {
    const h = harness({ outcome: 'gas-receipt', after: [{ ...round, phase: 'Reveal' }] });
    await run(h.config, false, () => {}, h.transport);
    expect(h.calls.at(-1)?.method).toBe('ping');
  });
  for (const phase of ['Sealing', 'Opening'] as const) it(`does not heartbeat for an idle pending ${phase} callback`, async () => {
    const pending: Round = { ...round, phase, begin_status: 'pending', open_status: 'pending' };
    const h = harness({ rounds: [pending] });
    await run({ ...h.config, KEEPER_MODES: '0' }, false, () => {}, h.transport);
    expect(h.calls.some(c => c.method === 'send_tx' || c.method === 'ping')).toBe(false);
  });
});
