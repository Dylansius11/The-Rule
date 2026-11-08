import { loadWasm } from './wasm';
import type { ReplayResult } from '@/game/types';
import type { ReplayInput, VerifierRow, Verification } from './types';

self.onmessage = async (event: MessageEvent<ReplayInput>) => {
  try {
    const { rows, rule, salt, commit, total } = event.data;
    const wasm = await loadWasm();
    const ruleJson = JSON.stringify(rule);
    const verify = (items: VerifierRow[], length: number): Verification => {
      const result = wasm.verify_round(
        JSON.stringify(items),
        ruleJson,
        JSON.stringify(salt),
        JSON.stringify(commit),
        length,
      );
      return JSON.parse(result) as Verification;
    };
    const full = verify(rows, total);
    const commitmentOk = verify([], 0).status === 'pass';
    const logComplete =
      rows.length === total &&
      rows.every((row, i) => row.log_idx === i) &&
      new Set(rows.map(row => row.seq)).size === rows.length;
    const matched = rows.filter(row => {
      const result = wasm.consistent(ruleJson, JSON.stringify([row]));
      return (JSON.parse(result) as Verification).status === 'pass';
    }).length;
    const result: ReplayResult = {
      pass: full.status === 'pass',
      commitmentOk,
      logComplete,
      matched,
      total,
      firstFailure: full.status === 'fail' ? full.reason : null,
    };
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
