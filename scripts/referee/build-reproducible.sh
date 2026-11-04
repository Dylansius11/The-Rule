#!/usr/bin/env bash
# Build the supplied workspace snapshot in a fresh container, without a target cache.
set -euo pipefail
: "${RULE_GAME_ACCOUNT:?set the exact testnet game account}"
if [ "$#" -ne 2 ]; then
    echo "Usage: RULE_GAME_ACCOUNT=game-r1.therule.testnet $0 WORKSPACE_SNAPSHOT OUTPUT.wasm" >&2
    exit 2
fi
source_dir=$(cd "$1" && pwd)
output=$2
mkdir -p "$(dirname "$output")"
output=$(cd "$(dirname "$output")" && pwd)/$(basename "$output")
root=$(git rev-parse --show-toplevel)
mkdir -p "$root/scratch/repro"
work=$(mktemp -d "$root/scratch/repro/container-XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/out"
# WSL can use the Windows Docker CLI even without Docker Desktop WSL integration.
if command -v docker.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    docker=docker.exe
    source_mount=$(wslpath -w "$source_dir")
    output_mount=$(wslpath -w "$work/out")
else
    docker=docker
    source_mount=$source_dir
    output_mount=$work/out
fi
printf 'Snapshot: %s\nCaller: %s\n' "$source_dir" "$RULE_GAME_ACCOUNT"
"$docker" run --rm --platform linux/amd64 \
    --mount "type=bind,src=$source_mount,dst=/workspace,readonly" \
    --mount "type=bind,src=$output_mount,dst=/out" -w /workspace \
    -e "RULE_GAME_ACCOUNT=$RULE_GAME_ACCOUNT" -e SOURCE_DATE_EPOCH=0 \
    -e CARGO_BUILD_JOBS=2 -e CARGO_TARGET_DIR=/tmp/target \
    -e 'RUSTFLAGS=--remap-path-prefix=/workspace=/source --remap-path-prefix=/usr/local/cargo=/cargo' \
    rust:1.97.1@sha256:4277ce860337f6cfa1b679891bbf689a447f4b3f4f55701742614ad31321cee7 \
    bash -eu -c 'rustup target add wasm32-wasip2; cargo build --locked -p referee --release --target wasm32-wasip2; cp /tmp/target/wasm32-wasip2/release/referee.wasm /out/referee.wasm'
cp "$work/out/referee.wasm" "$output"
sha256sum "$output"
