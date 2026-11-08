import { readFile } from 'node:fs/promises';
import { describe, expect, it, beforeAll } from 'vitest';
import init, * as bindings from '@the-rule/verifier-wasm';
import type { VerifierBindings } from './wasm';
import solo from './fixtures/solo-round-0.json';
import team from './fixtures/team-round-0.json';

const wasm = bindings as unknown as VerifierBindings;

beforeAll(async () => {
  const bytes = await readFile(
    new URL('../../../../verifier/wasm/pkg/verifier_wasm_bg.wasm', import.meta.url),
  );
  await init({ module_or_path: bytes });
});

describe('captured game-r2 testnet rounds', () => {
  for (const [name, fixture, count] of [
    ['solo', solo, 52],
    ['team', team, 11],
  ] as const) {
    it(`replays ${name} round 0 (${count} rows)`, () => {
      const { round, rows } = fixture;
      const output = wasm.verify_round(
        JSON.stringify(rows),
        JSON.stringify(round.rule),
        JSON.stringify(round.salt),
        JSON.stringify(round.commit),
        round.log_len,
      );
      expect(JSON.parse(output)).toEqual({ status: 'pass', matched: count, total: count });
    });
  }

  it('reports the exact verdict mismatch after tampering', () => {
    const rows = structuredClone(solo.rows);
    rows[0]!.verdict = !rows[0]!.verdict;
    const { round } = solo;
    const output = wasm.verify_round(
      JSON.stringify(rows),
      JSON.stringify(round.rule),
      JSON.stringify(round.salt),
      JSON.stringify(round.commit),
      round.log_len,
    );
    expect(JSON.parse(output)).toEqual({
      status: 'fail',
      reason: 'verdict mismatch at index 0: recorded false, expected true',
    });
  });

  it('exposes the shared descriptions, canonical encoding and protocol commitment', () => {
    const catalog = JSON.parse(wasm.atom_catalog());
    expect(catalog.atoms).toHaveLength(90);
    expect(catalog.atoms[22].negated).toBe('the number is 300 or more');
    expect(catalog.forms.map((form: { id: number }) => form.id)).toEqual([0, 1, 2]);
    const rule = JSON.stringify(solo.round.rule);
    expect(JSON.parse(wasm.describe_rule(rule))).toEqual({
      english: 'the number is 300 or more',
      dsl: 'NOT (n < 300)',
      json: '{"v":"g1","form":0,"lits":[[22,1]]}',
    });
    const teamText = JSON.parse(wasm.describe_rule(JSON.stringify(team.round.rule)));
    expect(teamText.english).toBe(
      'the number does not leave remainder 3 when divided by 4, or the play lands in a minute ending in 0 to 2',
    );
    expect(wasm.encode_rule_hex(rule)).toBe('673100011601');
    const hash = wasm.commit_hash(
      'testnet',
      'game-r2.therule.testnet',
      0,
      0,
      'therule.testnet',
      '{"tag":0,"id":0}',
      rule,
      '00'.repeat(32),
    );
    expect(hash).toBe('905322903f2cf0346686665f84298452990a5a084fafe6157b4ca251cb1558f7');
  });
});
