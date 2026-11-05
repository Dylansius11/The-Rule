#!/usr/bin/env bash
# Local golden vectors across native, WASI, sandbox contract wasm and web bindings in Node.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd "$root"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/target-the-rule}"
mkdir -p "$CARGO_TARGET_DIR"
export CARGO_TARGET_DIR="$(cd "$CARGO_TARGET_DIR" && pwd -P)"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
WASMTIME="${WASMTIME:-wasmtime}"
WASM_BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"
for cmd in cargo node "$WASMTIME" "$WASM_BINDGEN"; do
  command -v "$cmd" >/dev/null || { echo "missing prerequisite: $cmd" >&2; exit 1; }
done
if [[ $("$WASM_BINDGEN" --version) != 'wasm-bindgen 0.2.130' ]]; then
  echo 'wasm-bindgen CLI 0.2.130 is required to match verifier/wasm' >&2
  exit 1
fi
adapter=tests/sandbox/examples/vector-adapter/Cargo.toml
mkdir -p scratch
tmp=$(mktemp -d "$root/scratch/rule-vectors.XXXXXXXX")
trap 'rm -rf "$tmp"' EXIT

echo 'Native golden vectors'
cargo run --locked --manifest-path "$adapter" --release --bin vector-adapter > "$tmp/cases.json"

echo 'WASI golden vectors (wasmtime)'
cargo build --locked --manifest-path "$adapter" --release --target wasm32-wasip2 --bin vector-adapter
"$WASMTIME" run "$CARGO_TARGET_DIR/wasm32-wasip2/release/vector-adapter.wasm" > "$tmp/wasi.json"
cmp "$tmp/cases.json" "$tmp/wasi.json"

echo 'Sandbox contract wasm golden vectors (local NEAR sandbox only)'
cargo build --locked --manifest-path "$adapter" --release --target wasm32-unknown-unknown --lib
VECTOR_CASES="$tmp/cases.json" \
  VECTOR_ADAPTER_WASM="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/vector_adapter.wasm" \
  cargo run --locked -p sandbox-tests --profile fast --example vectors

echo 'Web-target wasm-bindgen golden vectors (Node, not a browser)'
cargo build --locked --manifest-path "$adapter" --release --target wasm32-unknown-unknown --lib --no-default-features --features web
"$WASM_BINDGEN" --target web --out-dir "$tmp/adapter" "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/vector_adapter.wasm"
cargo build --locked --manifest-path verifier/wasm/Cargo.toml --release --target wasm32-unknown-unknown --lib
"$WASM_BINDGEN" --target web --out-dir "$tmp/verifier" "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/verifier_wasm.wasm"
printf '%s\n' '{"type":"module"}' > "$tmp/package.json"
node verifier/wasm/vectors.mjs "$tmp/adapter" "$tmp/verifier" "$tmp/cases.json"
echo 'PASS: all golden vectors matched on four targets; browser/worker execution not tested'
