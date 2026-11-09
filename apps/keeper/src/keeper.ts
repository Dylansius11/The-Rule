import { Account, JsonRpcProvider, actions, baseEncode, encodeTransaction } from 'near-api-js';
import { decide, uint, type Decision, type Mode, type NextSlot, type Params, type Round } from './game.ts';
import { createNativeSigner } from './signer.ts';

export interface Config { NEAR_RPC_URL: string; GAME_ACCOUNT: string; KEEPER_ACCOUNT?: string; KEEPER_PRIVATE_KEY?: string; HEALTHCHECK_PING_URL?: string; NEAR_NETWORK?: 'testnet' | 'sandbox'; MAINTAIN_SEASONS?: string; KEEPER_MODES?: string; FIRST_ROUND_ID?: string; LAST_ROUND_ID?: string }
type Log = (message: string) => void;
type Snapshot = { params: Params; rounds: Round[]; slots: [NextSlot, NextSlot]; now: bigint; hash: string };

function parse(text: string): unknown {
  // RPC byte arrays contain only 0..255. Walking every byte with a reviver
  // burns the Free Worker's CPU; use it only when a potentially unsafe literal
  // occurs. False positives inside strings merely take the conservative path.
  if (!/\d{16}/.test(text)) return JSON.parse(text);
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source && /^\d+$/.test(context.source)) return context.source;
    return value;
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid RPC object');
  return value as Record<string, unknown>;
}
function success(status: unknown): boolean {
  const s = object(status);
  return (typeof s.SuccessValue === 'string' && Object.keys(s).length === 1) || (typeof s.SuccessReceiptId === 'string' && s.SuccessReceiptId.length > 0 && Object.keys(s).length === 1);
}
// Receipt ids can include gas/data receipts without execution outcomes. Require the
// transaction's action outcome and every returned outcome, plus the post-state.
function receipts(outcome: unknown): boolean {
  const result = object(outcome);
  if (result.final_execution_status !== 'FINAL' || !success(result.status) || !Array.isArray(result.receipts_outcome) || result.receipts_outcome.length === 0) return false;
  const root = object(result.transaction_outcome);
  const all = [root, ...result.receipts_outcome.map(object)];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of all) {
    if (typeof item.id !== 'string' || !item.id || byId.has(item.id)) return false;
    byId.set(item.id, item);
    const execution = object(item.outcome);
    if (!success(execution.status) || !Array.isArray(execution.receipt_ids) || execution.receipt_ids.some(id => typeof id !== 'string' || !id)) return false;
  }
  const rootStatus = object(object(root.outcome).status);
  if (typeof rootStatus.SuccessReceiptId !== 'string' || !byId.has(rootStatus.SuccessReceiptId)) return false;
  return true;
}
function same(a: Decision, b: Decision): boolean { return a.method === b.method && a.args.mode === b.args.mode && a.args.round_id === b.args.round_id; }
function validAccount(id: string): boolean { return id.length >= 2 && id.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id); }

export async function run(config: Config, dryRun = false, log: Log = console.log, transport: typeof fetch = fetch): Promise<void> {
  let stage = 'configuration';
  let lastRpc = 'none';
  let rpcFailure = 'none';
  async function rpc(method: string, params: object): Promise<unknown> {
    lastRpc = method === 'query' && 'method_name' in params && typeof params.method_name === 'string' ? params.method_name : method;
    rpcFailure = 'transport';
    const response = await transport(config.NEAR_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok) { rpcFailure = `http-${response.status}`; throw new Error('RPC HTTP failure'); }
    const data = object(parse(await response.text()));
    if (data.error || data.result === undefined) { rpcFailure = 'response'; throw new Error('RPC failure'); }
    rpcFailure = 'none';
    return data.result;
  }
  async function view(hash: string, method_name: string, args: object): Promise<unknown> {
    const args_base64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))));
    const result = object(await rpc('query', { request_type: 'call_function', block_id: hash, account_id: config.GAME_ACCOUNT, method_name, args_base64 }));
    if (!Array.isArray(result.result) || result.result.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Invalid view response');
    return parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(result.result)));
  }
  async function snapshot(): Promise<Snapshot> {
    const block = object(await rpc('block', { finality: 'final' }));
    const header = object(block.header);
    if (typeof header.hash !== 'string' || !header.hash) throw new Error('Invalid block');
    const hash = header.hash;
    const now = uint(header.timestamp_nanosec, 64);
    const params = await view(hash, 'get_params', {}) as Params;
    const rounds = await view(hash, 'get_active_rounds', {}) as Round[];
    const slots = [await view(hash, 'get_next_slot', { mode: 0 }), await view(hash, 'get_next_slot', { mode: 1 })] as [NextSlot, NextSlot];
    decide(params, rounds, slots, now);
    return { params, rounds, slots, now, hash };
  }
  const modes = config.KEEPER_MODES ?? '0,1';
  if (!['0', '1', '0,1'].includes(modes)) throw new Error('Invalid keeper modes');
  const selectedModes: Mode[] = modes === '0' ? [0] : modes === '1' ? [1] : [0, 1];
  const firstRound = config.FIRST_ROUND_ID === undefined ? 0 : Number(uint(config.FIRST_ROUND_ID, 32));
  const lastRound = config.LAST_ROUND_ID === undefined ? undefined : Number(uint(config.LAST_ROUND_ID, 32));
  if (lastRound !== undefined && firstRound > lastRound) throw new Error('Invalid round range');
  function authorized(mode: Mode, id: number): boolean {
    return selectedModes.includes(mode) && id >= firstRound && (lastRound === undefined || id <= lastRound);
  }
  async function seasonTargets(state: Snapshot): Promise<{ mode: Mode; season: number }[]> {
    const keys = new Set<string>();
    for (const round of state.rounds) if (authorized(round.mode, round.round_id)) keys.add(`${round.mode}:${Math.floor(round.round_id / 7)}`);
    for (const mode of selectedModes) {
      const current = await view(state.hash, 'get_round', { mode }) as Round | null;
      if (current === null) continue;
      if (current.mode !== mode || typeof current.round_id !== 'number') throw new Error('Invalid current round');
      uint(current.round_id, 32);
      const season = Math.floor(current.round_id / 7);
      if (season >= Math.floor(firstRound / 7) && (lastRound === undefined || season <= Math.floor(lastRound / 7))) keys.add(`${mode}:${season}`);
      if (season > 0 && season - 1 >= Math.floor(firstRound / 7) && (lastRound === undefined || season - 1 <= Math.floor(lastRound / 7))) keys.add(`${mode}:${season - 1}`);
    }
    return [...keys].map(key => {
      const [mode, season] = key.split(':').map(Number);
      return { mode: mode as Mode, season };
    });
  }
  async function seasonStatus(hash: string, mode: Mode, season: number): Promise<{ ready: boolean; total: bigint; indexed: bigint; revision: bigint }> {
    const status = object(await view(hash, 'get_season_status', { mode, season }));
    if (typeof status.ready !== 'boolean' || typeof status.total !== 'number' || typeof status.indexed !== 'number') throw new Error('Invalid season status');
    const total = uint(status.total, 32), indexed = uint(status.indexed, 32), revision = uint(status.revision, 64);
    if (indexed > total || status.ready !== (indexed === total)) throw new Error('Invalid season status');
    return { ready: status.ready, total, indexed, revision };
  }
  try {
    const network = config.NEAR_NETWORK ?? 'testnet';
    const url = new URL(config.NEAR_RPC_URL);
    if (!['http:', 'https:'].includes(url.protocol) || !validAccount(config.GAME_ACCOUNT) || (network !== 'testnet' && network !== 'sandbox')) throw new Error('Invalid configuration');
    if (config.MAINTAIN_SEASONS !== undefined && config.MAINTAIN_SEASONS !== 'true' && config.MAINTAIN_SEASONS !== 'false') throw new Error('Invalid season configuration');
    if (network === 'sandbox' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) throw new Error('Sandbox must use loopback');
    if (network === 'testnet' && !config.GAME_ACCOUNT.endsWith('.testnet')) throw new Error('Invalid testnet game');
    if (!dryRun && (!config.HEALTHCHECK_PING_URL || !config.KEEPER_ACCOUNT || !config.KEEPER_PRIVATE_KEY || !validAccount(config.KEEPER_ACCOUNT) || (network === 'testnet' && !config.KEEPER_ACCOUNT.endsWith('.testnet')))) throw new Error('Missing configuration');
    const status = object(await rpc('status', {}));
    const sandboxChain = typeof status.chain_id === 'string' &&
      (['localnet', 'sandbox'].includes(status.chain_id) || /^test-chain-[A-Za-z0-9]+$/.test(status.chain_id));
    if (network === 'testnet' ? status.chain_id !== 'testnet' : !sandboxChain) throw new Error('Wrong network');
    let state = await snapshot();
    const initial = decide(state.params, state.rounds, state.slots, state.now).filter(decision => authorized(decision.args.mode, decision.args.round_id));
    if (!initial.length) log('decision=none');
    if (dryRun) {
      for (const decision of initial) log(`mode=${decision.args.mode} round=${decision.args.round_id} decision=${decision.method}`);
      if (config.MAINTAIN_SEASONS === 'true') {
        for (const { mode, season } of await seasonTargets(state)) {
          if (!(await seasonStatus(state.hash, mode, season)).ready) log(`mode=${mode} season=${season} decision=index_season`);
        }
      }
      return;
    }
    const provider = new JsonRpcProvider({ url: config.NEAR_RPC_URL }, { retries: 1 });
    // All SDK requests share the same transport and exactly one attempt, including send_tx.
    provider.sendJsonRpc = rpc as typeof provider.sendJsonRpc;
    let account: Account | undefined;
    async function send(method: string, args: object, gas: bigint) {
      stage = 'sign';
      account ??= new Account(config.KEEPER_ACCOUNT!, provider, await createNativeSigner(config.KEEPER_PRIVATE_KEY!));
      const signed = await account.createSignedTransaction({ receiverId: config.GAME_ACCOUNT, actions: [actions.functionCall(method, args, gas, 0n)] });
      const hash = baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encodeTransaction(signed.transaction) as BufferSource)));
      // Public identity is recorded before the single send; never log the signed
      // payload, arguments, endpoint or credential, even on an unknown outcome.
      log(`transaction=${hash} signer=${signed.transaction.signerId} nonce=${signed.transaction.nonce} method=${method}`);
      stage = 'send';
      const result = await provider.sendTransactionUntil(signed, 'FINAL');
      stage = 'receipt-validation';
      return result;
    }
    let unhealthy = false;
    for (const proposed of initial) {
      state = await snapshot();
      const fresh = decide(state.params, state.rounds, state.slots, state.now);
      if (!fresh.some(item => same(item, proposed)) || !authorized(proposed.args.mode, proposed.args.round_id)) { unhealthy = true; continue; }
      const mode = proposed.args.mode;
      const id = proposed.args.round_id;
      log(`mode=${mode} decision=${proposed.method}`);
      const result = await send(proposed.method, proposed.args, 300_000_000_000_000n);
      if (!receipts(result)) {
        // Races are not resubmitted and never produce a healthy heartbeat.
        if (/\bE(?:10|50)\b/.test(JSON.stringify(result.status))) { log(`mode=${mode} transition raced`); unhealthy = true; state = await snapshot(); continue; }
        throw new Error('Transaction incomplete or failed');
      }
      stage = 'post-state';
      state = await snapshot();
      const after = await view(state.hash, 'get_round', { mode, id }) as Round | null;
      if (!after || after.mode !== mode || after.round_id !== id) throw new Error('Missing postcondition');
      // Validate terminal fields without adding a terminal round to active decisions.
      if (after.phase === 'Settled' || after.phase === 'Void' || after.phase === 'Cancelled') {
        decide(state.params, [{ ...after, phase: 'Scheduled' }], state.slots, state.now);
      } else decide(state.params, [after], state.slots, state.now);
      const progressed = proposed.method === 'start_round' ? (after.begin_status === 'ok' && ['Investigation', 'Reveal', 'Opening', 'Settled', 'Void'].includes(after.phase)) :
        proposed.method === 'advance' ? ['Reveal', 'Opening', 'Settled', 'Void'].includes(after.phase) :
        proposed.method === 'finalize' ? ((after.phase === 'Reveal' && object(result.status).SuccessValue === 'bnVsbA==') || ['Settled', 'Void'].includes(after.phase)) :
        proposed.method === 'retry_open' ? ['Settled', 'Void'].includes(after.phase) : after.phase === 'Cancelled';
      if (!progressed) unhealthy = true;
      log(`mode=${mode} postcondition=${progressed ? (proposed.method === 'finalize' && after.phase === 'Reveal' ? 'sweep' : after.phase) : 'waiting'}`);
    }
    const checkedSeasons: { mode: Mode; season: number; revision: bigint; indexed: bigint }[] = [];
    // Rebuild at most one batch per current, overlapping or previous season.
    if (config.MAINTAIN_SEASONS === 'true') {
      state = await snapshot();
      for (const { mode, season } of await seasonTargets(state)) {
        state = await snapshot();
        const before = await seasonStatus(state.hash, mode, season);
        if (before.ready) continue;
        log(`mode=${mode} season=${season} decision=index_season`);
        const result = await send('index_season', { mode, season, limit: 20 }, 200_000_000_000_000n);
        if (!receipts(result)) throw new Error('Season transaction incomplete or failed');
        state = await snapshot();
        const after = await seasonStatus(state.hash, mode, season);
        if (after.revision === before.revision && after.indexed > before.indexed) checkedSeasons.push({ mode, season, revision: after.revision, indexed: after.indexed });
        if (after.revision !== before.revision || after.indexed <= before.indexed) unhealthy = true;
        log(`mode=${mode} season=${season} postcondition=${after.revision === before.revision && after.indexed > before.indexed ? (after.ready ? 'ready' : 'partial') : 'waiting'}`);
      }
    }
    // A fresh same-block check, not a promise of timeliness or a replay of stale decisions.
    state = await snapshot();
    if (state.rounds.some(round => authorized(round.mode, round.round_id) &&
      ((round.phase === 'Sealing' && round.begin_status !== 'ok') ||
       (round.phase === 'Opening' && round.open_status !== 'ok')))) unhealthy = true;
    for (const checked of checkedSeasons) {
      const final = await seasonStatus(state.hash, checked.mode, checked.season);
      if (final.revision !== checked.revision || final.indexed < checked.indexed) unhealthy = true;
    }
    if (unhealthy) { log('keeper waiting; no heartbeat'); return; }
    stage = 'heartbeat';
    const ping = await transport(config.HEALTHCHECK_PING_URL!);
    if (!ping.ok) throw new Error('Heartbeat failed');
  } catch {
    log(`keeper failed stage=${stage} rpc=${lastRpc} rpc_failure=${rpcFailure}; no heartbeat`);
    throw new Error('Keeper run failed');
  }
}
