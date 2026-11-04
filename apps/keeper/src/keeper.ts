import { Account, JsonRpcProvider, actions, type KeyPairString } from 'near-api-js';
import { decide, type Integer, type NextSlot, type Params, type Round } from './game.ts';

export interface Config { NEAR_RPC_URL: string; GAME_ACCOUNT: string; KEEPER_ACCOUNT?: string; KEEPER_PRIVATE_KEY?: string; HEALTHCHECK_PING_URL?: string }
type Log = (message: string) => void;

// Preserve u64 JSON literals before JS can round their nanosecond values.
function parse(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source && /^\d+$/.test(context.source)) return context.source;
    return value;
  });
}

export async function run(config: Config, dryRun = false, log: Log = console.log, transport: typeof fetch = fetch): Promise<void> {
  async function rpc(method: string, params: object): Promise<unknown> {
    const response = await transport(config.NEAR_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok) throw new Error('RPC HTTP failure');
    const data = parse(await response.text()) as { error?: unknown; result?: unknown };
    if (data.error || data.result === undefined) throw new Error('RPC failure');
    return data.result;
  }
  async function view(method_name: string, args: object): Promise<unknown> {
    const args_base64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))));
    const result = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: config.GAME_ACCOUNT, method_name, args_base64 }) as { result: number[] };
    if (!Array.isArray(result.result)) throw new Error('Invalid view response');
    return parse(new TextDecoder().decode(new Uint8Array(result.result)));
  }
  try {
    if (!dryRun && !config.HEALTHCHECK_PING_URL) throw new Error('Missing heartbeat configuration');
    const params = await view('get_params', {}) as Params;
    const block = await rpc('block', { finality: 'final' }) as { header: { timestamp_nanosec: Integer } };
    const timestamp = block.header.timestamp_nanosec;
    if ((typeof timestamp === 'number' && (!Number.isSafeInteger(timestamp) || timestamp < 0)) || !/^\d+$/.test(String(timestamp))) throw new Error('Invalid block timestamp');
    const now = BigInt(timestamp);
    await view('get_round', { mode: 0 });
    await view('get_round', { mode: 1 });
    const rounds = await view('get_active_rounds', {}) as Round[];
    if (!Array.isArray(rounds)) throw new Error('Invalid active rounds');
    const slots = [await view('get_next_slot', { mode: 0 }), await view('get_next_slot', { mode: 1 })] as [NextSlot, NextSlot];
    const decisions = decide(params, rounds, slots, now);
    let reread = false;
    let failed = false;
    if (decisions.length === 0) log('decision=none');
    for (const decision of decisions) {
      const mode = decision.args.mode;
      log(`mode=${mode} decision=${decision.method}`);
      if (dryRun) continue;
      if (!config.KEEPER_ACCOUNT || !config.KEEPER_PRIVATE_KEY) throw new Error('Missing keeper credentials');
      const provider = new JsonRpcProvider({ url: config.NEAR_RPC_URL }, { retries: 1 });
      const account = new Account(config.KEEPER_ACCOUNT, provider, config.KEEPER_PRIVATE_KEY as KeyPairString);
      const outcome = await account.signAndSendTransaction({ receiverId: config.GAME_ACCOUNT, actions: [actions.functionCall(decision.method, decision.args, 200_000_000_000_000n, 0n)], waitUntil: 'FINAL', retries: 0, throwOnFailure: false });
      if (outcome.final_execution_status !== 'FINAL') throw new Error('Transaction not final');
      if (typeof outcome.status !== 'object' || outcome.status === null || !('SuccessValue' in outcome.status || 'SuccessReceiptId' in outcome.status)) {
        const failure = JSON.stringify(outcome.status);
        if (/\bE(?:10|50)\b/.test(failure)) {
          log(`mode=${mode} transition raced`);
          if (!reread) {
            await view('get_round', { mode });
            reread = true;
          }
          failed = true;
          continue;
        }
        throw new Error('Transaction failed');
      }
      log(`mode=${mode} transaction=FINAL`);
    }
    if (!dryRun && !failed && config.HEALTHCHECK_PING_URL) {
      const response = await transport(config.HEALTHCHECK_PING_URL);
      if (!response.ok) throw new Error('Heartbeat failed');
    }
  } catch {
    // Never print RPC exceptions: they can contain URLs, request headers or keys.
    log('keeper failed; no heartbeat');
    throw new Error('Keeper run failed');
  }
}
