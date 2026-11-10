// Offline Node diagnostic, not workerd or deployed Workers CPU qualification.
// node --experimental-strip-types apps/keeper/ci/cpu-profile.ts [signed|idle] [warmup] [iterations] [samples] [keeper-source]
// Run each scenario in a fresh process for a cold module/first-invocation sample.
// keeper-source may point at the same file in a comparable parent checkout; use the
// same Node, dependencies, scenario, warmup, iteration count and machine for both.
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { run as KeeperRun } from '../src/keeper.ts';
const [scenario = 'signed', warmupArg = '100', iterationsArg = '1000', samplesArg = '4', source = 'apps/keeper/src/keeper.ts'] = process.argv.slice(2);
if (scenario !== 'signed' && scenario !== 'idle') throw new Error('Expected signed or idle');
const counts = [warmupArg, iterationsArg, samplesArg].map(Number);
if (counts.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Counts must be positive integers');
const [warmup, iterations, samples] = counts;
const cpu = () => { const t = process.cpuUsage(); return t.user + t.system; }; // process-wide microseconds, including native workers
const moduleStart = cpu();
// Runtime-selected source permits an identical harness against a parent checkout.
const { run } = await import(pathToFileURL(resolve(source)).href) as { run: typeof KeeperRun };
const moduleCpu = cpu() - moduleStart;
// Deliberately load the SDK only after timing the keeper's cold dependency graph.
const { baseEncode } = await import('near-api-js');
// RFC 8032 public test vector, never an operational credential.
const secret = `ed25519:${baseEncode(Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'))}`;
const config = { NEAR_RPC_URL: 'https://rpc.invalid', GAME_ACCOUNT: 'game.testnet', KEEPER_ACCOUNT: 'keeper.testnet', KEEPER_PRIVATE_KEY: secret, HEALTHCHECK_PING_URL: 'https://heartbeat.invalid', KEEPER_MODES: '0', FIRST_ROUND_ID: '0', LAST_ROUND_ID: '0' };
const hash = '11111111111111111111111111111111';
const now = '1700000000000000000';
const params = { genesis_ns: '1699999999999999900', round_period_ns: '1000', mode_offset_ns: [0, 20], investigation_max_ns: 20, reveal_window_ns: 10, begin_timeout_ns: 30, open_timeout_ns: 40 };
const round = { mode: 0, round_id: 0, phase: 'Investigation', slot_ns: '1699999999999999900', sealing_started_ns: '1699999999999999900', begin_status: 'ok', investigation_end_ns: scenario === 'signed' ? now : '1700000000000000001', freeze_ns: null, reveal_deadline_ns: '1700000000000000010', pending_checks: 0, opening_started_ns: null, open_status: 'none', pot: '0', log_len: 0 };
const after = { ...round, phase: 'Reveal' };
const slots = [{ round_id: 1, slot_ns: '1700000000000001000' }, { round_id: 0, slot_ns: '1700000000000001000' }];
const envelope = (value: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: value });
const view = (value: unknown) => envelope({ result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [] });
const responses = {
  status: envelope({ chain_id: 'testnet' }),
  block: `{"jsonrpc":"2.0","id":1,"result":{"header":{"hash":"${hash}","timestamp_nanosec":${now}}}}`,
  params: view(params), before: view([round]), after: view([after]), round: view(after),
  slot0: view(slots[0]), slot1: view(slots[1]),
  key: envelope({ nonce: 1, permission: 'FullAccess', block_hash: hash, block_height: 1 }),
  send: envelope({ final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction_outcome: { id: 'tx', outcome: { status: { SuccessReceiptId: 'action' }, receipt_ids: ['action'] } }, receipts_outcome: [{ id: 'action', outcome: { status: { SuccessValue: '' }, receipt_ids: [] } }] }),
};
type Totals = Record<string, number>;
const add = (totals: Totals, key: string, value: number) => { totals[key] = (totals[key] ?? 0) + value; };
async function invocation(): Promise<Totals> {
  const totals: Totals = {};
  const trace: string[] = [];
  const logs: string[] = [];
  let sent = false;
  let previous = 'configuration-to-status';
  let boundary = cpu();
  const start = boundary;
  const transport: typeof fetch = async (input, init) => {
    const enter = cpu();
    add(totals, previous, enter - boundary);
    let body: string;
    if (String(input) === config.HEALTHCHECK_PING_URL) {
      trace.push('ping'); body = 'ok'; previous = 'after-ping';
    } else {
      assert.equal(String(input), config.NEAR_RPC_URL, 'unexpected network destination');
      const request = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
      const { method, params: p } = request;
      let label = method;
      if (method === 'status') body = responses.status;
      else if (method === 'block') {
        if (scenario === 'signed' && !sent && trace.length === 11) label = 'signing-block';
        body = responses.block;
      }
      else if (method === 'query' && p.request_type === 'view_access_key') { label = 'access-key'; body = responses.key; }
      else if (method === 'query' && p.request_type === 'call_function') {
        assert.equal(p.block_id, hash);
        label = String(p.method_name);
        if (label === 'get_params') body = responses.params;
        else if (label === 'get_active_rounds') body = sent ? responses.after : responses.before;
        else if (label === 'get_round') body = responses.round;
        else if (label === 'get_next_slot') {
          const args = JSON.parse(atob(String(p.args_base64))) as { mode: number };
          assert.ok(args.mode === 0 || args.mode === 1);
          label += `-${args.mode}`; body = args.mode === 0 ? responses.slot0 : responses.slot1;
        } else throw new Error('Unexpected view');
      } else if (method === 'send_tx') { assert.equal(sent, false); sent = true; body = responses.send; }
      else throw new Error('Unexpected RPC method');
      trace.push(label);
      previous = `after-${label}`;
    }
    const response = new Response(body, { headers: { 'content-type': 'application/json' } });
    boundary = cpu();
    add(totals, 'mock-transport', boundary - enter);
    return response;
  };
  await run(config, false, message => logs.push(message), transport);
  add(totals, previous, cpu() - boundary);
  totals.total = cpu() - start;
  const snapshot = ['block', 'get_params', 'get_active_rounds', 'get_next_slot-0', 'get_next_slot-1'];
  const expected = scenario === 'signed'
    ? ['status', ...snapshot, ...snapshot, 'signing-block', 'access-key', 'send_tx', ...snapshot, 'get_round', ...snapshot, 'ping']
    : ['status', ...snapshot, ...snapshot, 'ping'];
  assert.deepEqual(trace, expected, 'actual production RPC flow changed');
  assert.equal(logs.some(line => line === 'mode=0 postcondition=Reveal'), scenario === 'signed');
  assert.equal(logs.includes('keeper waiting; no heartbeat'), false);
  return totals;
}
function display(label: string, totals: Totals, divisor: number) {
  const values = Object.fromEntries(Object.entries(totals).map(([key, us]) => [key, Number((us / divisor / 1000).toFixed(4))]));
  console.log(JSON.stringify({ label, invocations: divisor, cpu_ms_per_invocation: values }));
}
console.log(JSON.stringify({ runtime: process.version, scenario, module_import_cpu_ms: moduleCpu / 1000, source: resolve(source), note: 'Node process CPU; interval labels follow each mock response and include response parsing, keeper/SDK work and measurement overhead. Mock CPU is separate; native worker CPU and scheduling may overlap. Not workerd/deployed CPU.' }));
display('first invocation (module already loaded)', await invocation(), 1);
for (let i = 0; i < warmup; i++) await invocation();
for (let sample = 1; sample <= samples; sample++) {
  const totals: Totals = {};
  for (let i = 0; i < iterations; i++) for (const [key, value] of Object.entries(await invocation())) add(totals, key, value);
  display(`warm sample ${sample}`, totals, iterations);
}
