import init, * as bindings from '@the-rule/verifier-wasm';
import wasmUrl from '../../../../verifier/wasm/pkg/verifier_wasm_bg.wasm?url';

export interface VerifierBindings {
  verify_round(rows: string, rule: string, salt: string, commit: string, length: number): string;
  consistent(rule: string, rows: string): string;
  describe_rule(rule: string): string;
  atom_catalog(): string;
  commit_hash(
    chain: string,
    game: string,
    mode: number,
    round: number,
    actor: string,
    entity: string,
    guess: string,
    salt: string,
  ): string;
  encode_rule_hex(rule: string): string;
}

let ready: Promise<VerifierBindings> | undefined;
export function loadWasm(): Promise<VerifierBindings> {
  return (ready ??= init({ module_or_path: wasmUrl })
    .then(() => bindings as unknown as VerifierBindings)
    .catch((error: unknown) => {
      ready = undefined;
      throw error;
    }));
}
