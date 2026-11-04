#!/usr/bin/env bash
# Run from any directory in WSL. RULE_GAME_ACCOUNT is mandatory for each build:
# RULE_GAME_ACCOUNT=game-r1.therule.testnet scripts/referee/audit-imports.sh
# The caller is embedded into the manifest and therefore changes the hash and key.
# Demo Mode - preselected rule: build with --features demo and set RULE_DEMO to a
# fair canonical-rule JSON object as an OutLayer secret, never in production.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
: "${RULE_GAME_ACCOUNT:?set the exact testnet game account}"
: "${CARGO_TARGET_DIR:?set a WSL-local CARGO_TARGET_DIR}"
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
mkdir -p scratch/referee
cargo build -p referee --release --target wasm32-wasip2
wasm="$CARGO_TARGET_DIR/wasm32-wasip2/release/referee.wasm"
cp "$wasm" scratch/referee/production.wasm
wasm-tools component wit "$wasm" > enclave/referee/IMPORTS.txt
if grep -Eq '^[[:space:]]*import (wasi:sockets|wasi:http|wasi:filesystem)' enclave/referee/IMPORTS.txt; then
    echo 'FAIL: forbidden network or filesystem import' >&2; exit 1
fi
if ! grep -q 'import outlayer:encryption-keys/api@0.1.0' enclave/referee/IMPORTS.txt; then
    echo 'FAIL: missing OutLayer MAC import' >&2; exit 1
fi
cargo build -p referee --release --target wasm32-wasip2 --features demo
cp "$wasm" scratch/referee/demo.wasm
if grep -aq 'RULE_DEMO' scratch/referee/production.wasm; then
    echo 'FAIL: production contains demo environment key' >&2; exit 1
fi
if ! grep -aq 'RULE_DEMO' scratch/referee/demo.wasm; then
    echo 'FAIL: demo environment key missing' >&2; exit 1
fi
prod=$(sha256sum scratch/referee/production.wasm | cut -d ' ' -f 1)
demo=$(sha256sum scratch/referee/demo.wasm | cut -d ' ' -f 1)
test "$prod" != "$demo" || { echo 'FAIL: demo and production hashes match' >&2; exit 1; }
printf 'Production: %s bytes sha256 %s\n' "$(wc -c < scratch/referee/production.wasm)" "$prod"
printf 'Demo: %s bytes sha256 %s\n' "$(wc -c < scratch/referee/demo.wasm)" "$demo"
echo 'PASS: OutLayer MAC present; no network or filesystem imports; hashes differ'
