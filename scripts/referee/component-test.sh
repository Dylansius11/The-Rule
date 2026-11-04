#!/usr/bin/env bash
# Local test only: composed bytes are not a deployable referee.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
: "${CARGO_TARGET_DIR:?set CARGO_TARGET_DIR to a WSL-local directory}"
: "${WASM_TOOLS:=wasm-tools}"
: "${WASMTIME:=wasmtime}"
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
export RULE_GAME_ACCOUNT=game.testnet
mkdir -p scratch/referee/component-test
cargo build -p referee --release --target wasm32-wasip2
cargo build --manifest-path enclave/referee/stub-host/Cargo.toml --release --target wasm32-wasip2 --locked
"$WASM_TOOLS" compose "$CARGO_TARGET_DIR/wasm32-wasip2/release/referee.wasm" \
  -d "$CARGO_TARGET_DIR/wasm32-wasip2/release/stubhost.wasm" \
  -o scratch/referee/component-test/composed.wasm
python3 - "$WASMTIME" <<'PY'
import hashlib
import json
from pathlib import Path
import subprocess
import sys

fixture = json.loads(Path('tests/vectors/referee-io.json').read_text())['stub_mac_vectors']
root = Path('scratch/referee/component-test')
context = bytes.fromhex(fixture['context_hex'])
key = hashlib.sha256(b'test-only-stub-key' + context).hexdigest()
commit = fixture['begin_response']['commit']
begin = fixture['begin_request']
common = {**begin, 'commit': commit}
cases = {
    'begin': (begin, fixture['begin_response']),
    'verdict': ({**common, 'op':'verdict', 'play':{'number':124,'word_id':0,'minute_digit':4,'prev':None}}, fixture['verdict_response']),
    'guess': ({**common, 'op':'guess', 'guess':'6731010212011f01'}, fixture['guess_response']),
    'open': ({**common, 'op':'open'}, fixture['open_response']),
    'mismatch': ({**common, 'op':'open', 'commit':'11'*32}, None),
}
secret_tokens = [key, fixture['open_response']['salt'], json.dumps(fixture['open_response']['rule'], separators=(',', ':'))]
for name, (request, expected) in cases.items():
    encoded = json.dumps(request, separators=(',', ':')).encode()
    result = subprocess.run([sys.argv[1], 'run', str(root / 'composed.wasm')], input=encoded, capture_output=True, check=False)
    (root / (name + '.stdout')).write_bytes(result.stdout)
    (root / (name + '.stderr')).write_bytes(result.stderr)
    if expected is None:
        assert result.returncode != 0, (name, result.returncode)
        assert result.stdout == b'', (name, result.stdout)
    else:
        assert result.returncode == 0, (name, result.returncode, result.stderr)
        want = json.dumps(expected, separators=(',', ':')).encode()
        assert result.stdout == want, (name, result.stdout, want)
    for secret in secret_tokens:
        assert secret.encode() not in result.stderr, name + ': secret in stderr'
        if name != 'open':
            assert secret.encode() not in result.stdout, name + ': secret in stdout'
    if name != 'mismatch':
        assert result.stderr == b'', (name, result.stderr)
    print(name + ': ' + (result.stdout.decode() if result.stdout else '<empty stdout>') + '; stderr=' + ('empty' if not result.stderr else 'nonempty, checked for secrets'))
print('PASS: exact stub vectors, mismatch failure, and captured stderr')
PY
