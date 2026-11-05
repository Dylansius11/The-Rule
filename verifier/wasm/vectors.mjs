// Run web-target bindings in Node. This is not a browser/worker test.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { strict as assert } from 'node:assert';

const [adapterDir, verifierDir, casesPath] = process.argv.slice(2);
if (!adapterDir || !verifierDir || !casesPath) throw new Error('usage: node vectors.mjs <adapter-dir> <verifier-dir> <cases>');
async function bindings(directory, name) {
  const module = await import(pathToFileURL(resolve(directory, `${name}.js`)).href);
  await module.default({ module_or_path: readFileSync(resolve(directory, `${name}_bg.wasm`)) });
  return module;
}
const adapter = await bindings(adapterDir, 'vector_adapter');
const verifier = await bindings(verifierDir, 'verifier_wasm');
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
assert.ok(Array.isArray(cases) && cases.length > 0, 'empty vector fixture');
for (const [index, item] of cases.entries()) {
  const actual = JSON.parse(adapter.run_vector(item.kind, JSON.stringify(item.input)));
  assert.deepEqual(actual, item.expected, `browser-target vector ${index}`);
  if (item.kind === 'replay') {
    const { round, rows } = item.input;
    assert.equal(round.phase, 'Settled', `vector ${index} phase`);
    const replay = JSON.parse(verifier.verify_round(JSON.stringify(rows), JSON.stringify(round.rule),
      JSON.stringify(round.salt), JSON.stringify(round.commit), round.log_len));
    assert.deepEqual(replay, item.expected, `verifier vector ${index}`);
  }
}
console.log(`browser-target: ${cases.length} golden vectors matched (Node, not a browser)`);
