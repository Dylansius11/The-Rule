import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import init, { verify_round, consistent } from './pkg/verifier_wasm.js';

// Run with Windows Node; pass the absolute WSL path to the native `rule` binary.
const native = process.argv[2];
if (!native) throw new Error('usage: node verifier/wasm/smoke.mjs /absolute/wsl/path/to/rule');
await init({ module_or_path: readFileSync(new URL('./pkg/verifier_wasm_bg.wasm', import.meta.url)) });
const cases = JSON.parse(readFileSync(new URL('../../tests/vectors/verify.json', import.meta.url), 'utf8'));
const temporary = fileURLToPath(new URL('../../scratch/verifier/smoke-export.json', import.meta.url));
const converted = spawnSync('wsl.exe', ['-e', 'wslpath', '-a', temporary], { encoding: 'utf8' });
if (converted.status !== 0) throw new Error(converted.stderr);
try {
  for (const [index, item] of cases.entries()) {
    const { round, rows } = item.export;
    writeFileSync(temporary, JSON.stringify(item.export));
    const result = spawnSync('wsl.exe', ['-e', native, 'verify', '--from-file', converted.stdout.trim(), '--json'], { encoding: 'utf8' });
    if (result.error) throw result.error;
    const actual = JSON.parse(result.stdout);
    const wasm = JSON.parse(verify_round(JSON.stringify(rows), JSON.stringify(round.rule), JSON.stringify(round.salt), JSON.stringify(round.commit), round.log_len));
    assert.deepEqual(actual, item.expected);
    assert.deepEqual(wasm, actual);
    const replay = JSON.parse(consistent(JSON.stringify(round.rule), JSON.stringify(rows)));
    if (index === 1 || index === 4) assert.deepEqual(replay, item.expected);
    else assert.deepEqual(replay, { status: 'pass', matched: rows.length, total: rows.length });
    assert.equal(result.status, actual.status === 'pass' ? 0 : 1);
    console.log(`vector ${index}: native == wasm (${actual.status})`);
  }
} finally { unlinkSync(temporary); }
console.log(`PASS: ${cases.length} native/wasm vectors identical`);
