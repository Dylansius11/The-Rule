#!/usr/bin/env bash
# Isolated sandbox with mock OutLayer, not testnet evidence. Called from Playwright on Windows.
set -euo pipefail
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/target-the-rule}"
mkdir -p scratch/web-e2e
fixture=$(mktemp -d scratch/web-e2e/artifacts-XXXXXX)
trap 'rm -rf "$fixture"' EXIT
if [[ -z "${GAME_WASM:-}" || -z "${TOKEN_WASM:-}" || -z "${MOCK_OUTLAYER_WASM:-}" ]]; then
  mapfile -t disk < <(df -Pk /mnt/c)
  read -r _ _ _ available _ <<<"${disk[1]}"
  if (( available < 20971520 )); then
    echo 'At least 20 GiB free on C: is required before sandbox contract builds.' >&2
    exit 1
  fi
  bash scripts/build/sandbox-artifacts.sh
fi
# Snapshot this checkout's artifacts before another worktree can rebuild the shared target outputs.
cp "${GAME_WASM:-$CARGO_TARGET_DIR/near/game/game.wasm}" "$fixture/game.wasm"
cp "${TOKEN_WASM:-$CARGO_TARGET_DIR/near/token/token.wasm}" "$fixture/token.wasm"
cp "${MOCK_OUTLAYER_WASM:-$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/mock_outlayer.wasm}" "$fixture/mock.wasm"
export GAME_WASM="$fixture/game.wasm" TOKEN_WASM="$fixture/token.wasm" MOCK_OUTLAYER_WASM="$fixture/mock.wasm"
cargo run --locked -p sandbox-tests --profile fast --example web-e2e -- "$1" "${@:2}"
