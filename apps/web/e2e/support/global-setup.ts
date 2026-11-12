// Isolated sandbox with mock OutLayer, not testnet evidence.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const fixturePath = resolve(root, 'apps/web/e2e/support/.env.sandbox.json');
export type SandboxConfig = {
  label: string;
  rpcUrl: string;
  networkId: string;
  chainId: string;
  game: string;
  token: string;
  mock: string;
  controlUrl: string;
  accounts: { accountId: string; secretKey: string }[];
};
export const readConfig = async () => JSON.parse(await readFile(fixturePath, 'utf8')) as SandboxConfig;

export default async function setup() {
  const started = Date.now();
  const profile = process.env.THE_RULE_E2E_PROFILE;
  if (profile !== undefined && profile !== 'transitions') throw new Error('Unknown sandbox fixture profile');
  await mkdir(resolve(fixturePath, '..'), { recursive: true });
  await rm(fixturePath, { force: true });
  const scratch = resolve(root, 'scratch');
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(resolve(scratch, 'web-sandbox-'));
  const log = createWriteStream(resolve(temporary, 'harness.log'));
  const linuxPath = (path: string) =>
    path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // WSL does not inherit arbitrary Windows variables: explicitly forward only local artifact overrides.
  const overrides = ['CARGO_TARGET_DIR', 'GAME_WASM', 'TOKEN_WASM', 'MOCK_OUTLAYER_WASM']
    .flatMap(name => (process.env[name] ? [`${name}=${quote(process.env[name]!)}`] : []))
    .join(' ');
  const command = `cd ${quote(linuxPath(root))} && ${overrides ? `export ${overrides} && ` : ''}bash scripts/e2e/sandbox.sh ${quote(linuxPath(fixturePath))}${profile === 'transitions' ? ' transitions' : ''}`;
  const child = spawn('wsl.exe', ['-e', 'bash', '-lc', command], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.pipe(log, { end: false });
  const lines = createInterface({ input: child.stdout });
  let nextId = 0;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  // The web package targets ES2023, which does not expose Promise.withResolvers.
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  lines.on('line', line => {
    log.write(`${line}\n`);
    if (line === 'WEB_E2E_READY') readyResolve();
    if (line.startsWith('WEB_E2E_RESPONSE ')) {
      const response = JSON.parse(line.slice('WEB_E2E_RESPONSE '.length));
      const request = waiting.get(response.id);
      waiting.delete(response.id);
      if (response.error) request?.reject(new Error(response.error));
      else request?.resolve(response.result);
    }
  });
  child.on('error', readyReject);
  child.on('exit', code => {
    const error = new Error(`Sandbox harness exited (${code}); startup logs: ${temporary}`);
    readyReject(error);
    for (const request of waiting.values()) request.reject(error);
  });
  const control = (command: object) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      waiting.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5193');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      if (request.url === '/control') {
        const value = await control(JSON.parse(body));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ result: value }));
      } else if (request.url === '/rpc') {
        const upstream = await fetch(upstreamRpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        response.writeHead(upstream.status, { 'content-type': 'application/json' });
        response.end(await upstream.text());
      } else response.writeHead(404).end();
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  let upstreamRpc = '';
  const cleanup = async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(done => server.close(() => done()));
    child.stdin.end();
    if (child.exitCode === null)
      await Promise.race([
        new Promise<void>(done => child.once('exit', () => done())),
        new Promise<void>(done =>
          setTimeout(() => {
            child.kill();
            done();
          }, 10_000).unref(),
        ),
      ]);
    lines.close();
    await new Promise<void>(done => log.end(done));
    await rm(temporary, { recursive: true, force: true });
    await rm(fixturePath, { force: true });
  };
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sandbox startup exceeded 20 minutes')), 1_200_000).unref(),
      ),
    ]);
    const config = await readConfig();
    upstreamRpc = config.rpcUrl;
    // WSL2 localhost forwarding: Windows Node reaches the WSL node via 127.0.0.1.
    // Fail closed here rather than accidentally using a public fallback RPC.
    const statusResponse = await fetch(new URL('/status', upstreamRpc));
    if (!statusResponse.ok)
      throw new Error(`Windows-to-WSL sandbox status returned HTTP ${statusResponse.status}`);
    const status = await statusResponse.json();
    if (!/^test-chain-[A-Za-z0-9]+$/.test(status.chain_id))
      throw new Error(`Expected a near-workspaces test chain, got ${status.chain_id}`);
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing control address');
    const origin = `http://127.0.0.1:${address.port}`;
    await writeFile(
      fixturePath,
      JSON.stringify({ ...config, rpcUrl: `${origin}/rpc`, controlUrl: `${origin}/control` }),
    );
    console.log(
      `Sandbox with mock OutLayer, not testnet evidence: ready in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return cleanup;
  } catch (error) {
    // Build logs contain no fixture keys (the Rust program writes those only to config.json).
    console.error(await readFile(resolve(temporary, 'harness.log'), 'utf8'));
    await cleanup();
    throw error;
  }
}
