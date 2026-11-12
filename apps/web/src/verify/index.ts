import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getLog, getWords } from '@/chain/views';
import type { CanonicalRule, LogRow, Mode, ReplayResult, ReplayState, Round, RuleText } from '@/game/types';
import { loadWasm } from './wasm';
import { verifierRow } from './types';
import type { AtomCatalog, ReplayInput } from './types';

export type { AtomCatalog } from './types';

export function useRuleText(rule: CanonicalRule | null): RuleText | null {
  const json = rule ? JSON.stringify(rule) : null;
  const query = useQuery({
    queryKey: ['rule-text', json],
    enabled: json !== null,
    queryFn: async () => JSON.parse((await loadWasm()).describe_rule(json!)) as RuleText,
  });
  return query.data ?? null;
}

export function useAtomCatalog(): AtomCatalog {
  const query = useQuery({
    queryKey: ['atom-catalog'],
    queryFn: async () => JSON.parse((await loadWasm()).atom_catalog()) as AtomCatalog,
  });
  return query.data ?? { atoms: [], forms: [] };
}

export async function commitHash(input: {
  chain: string;
  game: string;
  mode: Mode;
  round: number;
  actor: string;
  entity: { tag: 0 | 1; id: number };
  guess: CanonicalRule;
  saltHex: string;
}): Promise<string> {
  return (await loadWasm()).commit_hash(
    input.chain,
    input.game,
    input.mode,
    input.round,
    input.actor,
    JSON.stringify(input.entity),
    JSON.stringify(input.guess),
    input.saltHex,
  );
}

export async function encodeRuleHex(rule: CanonicalRule): Promise<string> {
  return (await loadWasm()).encode_rule_hex(JSON.stringify(rule));
}

export function useReplay(round: Round | null): { state: ReplayState; run(): void } {
  const [state, setState] = useState<ReplayState>({ kind: 'idle' });
  const generation = useRef(0);
  const worker = useRef<Worker | null>(null);
  useEffect(() => {
    setState({ kind: 'idle' });
    return () => {
      generation.current++;
      worker.current?.terminate();
    };
  }, [round?.mode, round?.roundId]);

  const run = useCallback(() => {
    const current = ++generation.current;
    worker.current?.terminate();
    const started = performance.now();

    const fail = (error: unknown) => {
      if (generation.current !== current) return;
      setState({
        kind: 'error',
        error: {
          code: null,
          title: error instanceof Error ? error.message : String(error),
          funds: 'No funds moved.',
          next: 'Try replay again.',
          retryable: true,
        },
      });
    };

    void (async () => {
      if (!round?.rule || !round.salt || !round.commit) {
        throw new Error('This round has not revealed its rule, salt and commitment.');
      }
      setState({ kind: 'loading', loaded: 0, total: round.logLen });
      const words = await getWords();
      const rows: LogRow[] = [];
      while (rows.length < round.logLen) {
        const page = await getLog(
          round.mode,
          round.roundId,
          rows.length,
          Math.min(200, round.logLen - rows.length),
          words,
        );
        if (!page.length || page.length > 200) {
          throw new Error('The round log could not be loaded completely.');
        }
        rows.push(...page);
        if (generation.current !== current) return;
        setState({ kind: 'loading', loaded: rows.length, total: round.logLen });
      }
      if (generation.current !== current) return;
      setState({ kind: 'running' });
      const instance = new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<{ result?: ReplayResult; error?: string }>) => {
        instance.terminate();
        if (generation.current !== current) return;
        if (event.data.error || !event.data.result) {
          fail(new Error(event.data.error ?? 'Replay returned no result.'));
          return;
        }
        setState({ kind: 'done', result: event.data.result, elapsedMs: performance.now() - started });
      };
      instance.onerror = event => {
        instance.terminate();
        fail(new Error(event.message));
      };
      const input: ReplayInput = {
        rows: rows.map(verifierRow),
        rule: round.rule,
        salt: round.salt,
        commit: round.commit,
        total: round.logLen,
      };
      instance.postMessage(input);
    })().catch(fail);
  }, [round]);
  return { state, run };
}
