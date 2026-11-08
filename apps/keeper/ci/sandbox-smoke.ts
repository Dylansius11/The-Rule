// Lead-operated only: real local sandbox, current game WASM and disposable keys.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer as createTcpServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Account, JsonRpcProvider, actions, type KeyPairString } from 'near-api-js';
import { run, type Config } from '../src/keeper.ts';

const { NEAR_RPC_URL, GAME_ACCOUNT, KEEPER_ACCOUNT, KEEPER_PRIVATE_KEY, RACER_ACCOUNT, RACER_PRIVATE_KEY, KEEPER_SMOKE_CASE } = process.env;
if (!NEAR_RPC_URL || !GAME_ACCOUNT || !KEEPER_ACCOUNT || !KEEPER_PRIVATE_KEY || !['advance', 'pending', 'race', 'worker'].includes(KEEPER_SMOKE_CASE ?? '')) throw new Error('Missing sandbox smoke configuration');
const url = new URL(NEAR_RPC_URL);
if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Sandbox loopback required');
if (KEEPER_SMOKE_CASE === 'race' && (!RACER_ACCOUNT || !RACER_PRIVATE_KEY || RACER_ACCOUNT === KEEPER_ACCOUNT)) throw new Error('Distinct disposable racer required');

let pings = 0;
const heartbeat = createServer((_request, response) => { pings++; response.end('ok'); });
heartbeat.listen(0, '127.0.0.1');
await once(heartbeat, 'listening');
const address = heartbeat.address();
if (!address || typeof address === 'string') throw new Error('Heartbeat listener failed');
const config: Config = { NEAR_NETWORK: 'sandbox', NEAR_RPC_URL, GAME_ACCOUNT, KEEPER_ACCOUNT, KEEPER_PRIVATE_KEY, HEALTHCHECK_PING_URL: `http://127.0.0.1:${address.port}/ping`, KEEPER_MODES: '0' };
const provider = new JsonRpcProvider({ url: NEAR_RPC_URL }, { retries: 1 });
provider.sendJsonRpc = (async (method: string, params: object) => {
  const response = await fetch(NEAR_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw new Error('RPC HTTP failure');
  const body = await response.json() as { error?: unknown; result?: unknown };
  if (body.error || body.result === undefined) throw new Error('RPC failure');
  return body.result;
}) as typeof provider.sendJsonRpc;
const racer = KEEPER_SMOKE_CASE === 'race' ? new Account(RACER_ACCOUNT!, provider, RACER_PRIVATE_KEY as KeyPairString) : new Account(KEEPER_ACCOUNT, provider, KEEPER_PRIVATE_KEY as KeyPairString);
let sends = 0;
let sentResult: unknown;
let raceResult: unknown;
let dry = true;
let roundId = 0;
let stage = 'rpc-status';
const logKeeper = (message: string) => console.log(`keeper ${message}`);
async function round(): Promise<Record<string, unknown>> {
  const value = await provider.callFunction({ contractId: GAME_ACCOUNT!, method: 'get_round', args: { mode: 0 } });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing round');
  return value as Record<string, unknown>;
}
async function advance(id: number): Promise<unknown> {
  return racer.signAndSendTransaction({ receiverId: GAME_ACCOUNT!, actions: [actions.functionCall('advance', { mode: 0, round_id: id }, 300_000_000_000_000n, 0n)], waitUntil: 'FINAL', retries: 0, throwOnFailure: false });
}
const transport: typeof fetch = async (input, init) => {
  if (String(input) === config.HEALTHCHECK_PING_URL) return fetch(input, init);
  const request = JSON.parse(String(init?.body)) as { method?: string };
  if (request.method === 'send_tx') {
    if (dry) throw new Error('Dry run sent a transaction');
    sends++;
    stage = 'transaction-send';
    if (KEEPER_SMOKE_CASE === 'race') raceResult = await advance(roundId);
    const response = await fetch(input, init);
    sentResult = (await response.clone().json() as { result?: unknown }).result;
    const result = sentResult as { final_execution_status?: unknown; status?: unknown; receipts_outcome?: unknown } | undefined;
    console.log(`transaction final=${result?.final_execution_status === 'FINAL'} receipts=${Array.isArray(result?.receipts_outcome) ? result.receipts_outcome.length : 'missing'} success=${!!result?.status && typeof result.status === 'object' && 'SuccessValue' in result.status}`);
    stage = 'keeper-receipt-or-postcondition';
    return response;
  }
  return fetch(input, init);
};
try {
  const status = await provider.sendJsonRpc('status', {}) as { chain_id?: unknown };
  console.log(`sandbox chain_id=${typeof status.chain_id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(status.chain_id) ? status.chain_id : 'invalid'}`);
  stage = 'fixture-view';
  const before = await round();
  if (!Number.isInteger(before.round_id) || (before.round_id as number) < 0) throw new Error('Invalid round');
  roundId = before.round_id as number;
  if (KEEPER_SMOKE_CASE === 'pending' ? before.phase !== 'Sealing' || before.begin_status !== 'pending' : before.phase !== 'Investigation') throw new Error('Unexpected fixture state');
  stage = 'dry-run';
  await run(config, true, logKeeper, transport);
  if (JSON.stringify(await round()) !== JSON.stringify(before) || sends !== 0 || pings !== 0) throw new Error('Dry run changed state');
  dry = false;
  stage = KEEPER_SMOKE_CASE === 'worker' ? 'worker-start' : 'keeper-run';
  if (KEEPER_SMOKE_CASE === 'worker') {
    const scratch = fileURLToPath(new URL('../../../scratch/', import.meta.url));
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(`${scratch}keeper-worker-`);
    const listener = createTcpServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const selected = listener.address();
    if (!selected || typeof selected === 'string') throw new Error('Worker port failed');
    const port = selected.port;
    listener.close();
    await once(listener, 'close');
    const envFile = `${directory}/vars.env`;
    let worker: ChildProcess | undefined;
    let workerOutput = '';
    let outputTooLarge = false;
    const capture = (chunk: Buffer) => {
      if (outputTooLarge) return;
      if (workerOutput.length + chunk.length > 1_048_576) { workerOutput = ''; outputTooLarge = true; return; }
      workerOutput += chunk.toString();
    };
    const diagnostics = () => {
      if (outputTooLarge) return 'Worker output exceeded diagnostic limit';
      let text = workerOutput;
      for (const secret of [KEEPER_PRIVATE_KEY, RACER_PRIVATE_KEY, config.HEALTHCHECK_PING_URL]) {
        if (secret) text = text.replaceAll(secret, '[redacted]');
      }
      return text.slice(-4000);
    };
    const terminate = () => {
      worker?.kill();
      void rm(directory, { recursive: true, force: true }).finally(() => process.exit(1));
    };
    process.once('SIGTERM', terminate);
    try {
      await writeFile(envFile, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
      const wrangler = fileURLToPath(new URL('bin/wrangler.js', import.meta.resolve('wrangler/package.json')));
      worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--test-scheduled', '--ip', '127.0.0.1', '--port', String(port), '--env-file', envFile], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
      worker.stdout?.on('data', capture);
      worker.stderr?.on('data', capture);
      let spawnFailed = false;
      worker.once('error', () => { spawnFailed = true; });
      let ready = false;
      for (let i = 0; i < 300 && worker.exitCode === null && !spawnFailed; i++) {
        const result = Promise.withResolvers<boolean>();
        const socket = createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); result.resolve(true); });
        socket.once('error', () => result.resolve(false));
        ready = await result.promise;
        if (ready) break;
        await sleep(100);
      }
      if (!ready) {
        console.error(diagnostics());
        throw new Error('Worker did not start');
      }
      stage = 'worker-scheduled';
      const response = await fetch(`http://127.0.0.1:${port}/__scheduled?cron=*/2+*+*+*+*`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) { console.error(diagnostics()); throw new Error('Scheduled handler failed'); }
      for (let i = 0; i < 100 && pings === 0; i++) await sleep(100);
      stage = 'worker-postcondition';
      const after = await round();
      if (pings !== 1 || after.round_id !== roundId || after.phase !== 'Reveal') throw new Error('Worker postcondition failed');
    } finally {
      process.removeListener('SIGTERM', terminate);
      if (worker?.exitCode === null) {
        worker.kill();
        await Promise.race([once(worker, 'exit'), sleep(3000)]);
        if (worker.exitCode === null) worker.kill('SIGKILL');
      }
      await rm(directory, { recursive: true, force: true });
    }
  } else {
    await run(config, false, logKeeper, transport);
    stage = 'postcondition';
    const after = await round();
    if (KEEPER_SMOKE_CASE === 'pending') {
      if (sends !== 0 || pings !== 0 || after.phase !== 'Sealing' || after.begin_status !== 'pending') throw new Error('Pending callback produced a healthy result');
    } else {
      if (sends !== 1 || after.round_id !== roundId || after.phase !== 'Reveal') throw new Error('Transition postcondition failed');
      if (KEEPER_SMOKE_CASE === 'race') {
        if (!JSON.stringify(raceResult).includes('SuccessValue') || !/E10|E50/.test(JSON.stringify(sentResult)) || pings !== 0) throw new Error('Race was not fenced');
      } else {
        const result = sentResult as { final_execution_status?: unknown; receipts_outcome?: unknown[]; status?: unknown } | undefined;
        if (result?.final_execution_status !== 'FINAL' || !Array.isArray(result.receipts_outcome) || result.receipts_outcome.length === 0 || !JSON.stringify(result.status).includes('SuccessValue') || pings !== 1) throw new Error('Transition evidence incomplete');
        stage = 'duplicate';
        const duplicate = await advance(roundId);
        if (!/E10|E50/.test(JSON.stringify(duplicate)) || pings !== 1 || JSON.stringify(await round()) !== JSON.stringify(after)) throw new Error('Duplicate was not rejected');
      }
    }
  }
  console.log(`sandbox smoke ${KEEPER_SMOKE_CASE}: complete`);
} catch {
  console.error(`sandbox smoke ${KEEPER_SMOKE_CASE}: failed stage=${stage}`);
  process.exitCode = 1;
} finally {
  heartbeat.close();
}
