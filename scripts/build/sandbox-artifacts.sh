#!/usr/bin/env bash
# Build the wasm files the sandbox tests deploy: game, token (cargo near, no ABI) and the MOCK OutLayer.
# Run in WSL from the repo root. Output lives under $CARGO_TARGET_DIR (default ~/target-the-rule).
set -euo pipefail
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/target-the-rule}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config-the-rule}"   # keeps cargo-near off other projects' config
export CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}"
for c in game token; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi >/dev/null)
done
cargo build --manifest-path tests/sandbox/mock-outlayer/Cargo.toml --target wasm32-unknown-unknown --release --quiet
ls -l "$CARGO_TARGET_DIR/near/game/game.wasm" "$CARGO_TARGET_DIR/near/token/token.wasm" \
      "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/mock_outlayer.wasm"
echo "export CARGO_TARGET_DIR=$CARGO_TARGET_DIR"
