#!/usr/bin/env bash
# cargo-near builds committed Git sources, including the committed workspace lockfile.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
: "${XDG_CONFIG_HOME:?set XDG_CONFIG_HOME to the project-specific config directory}"
: "${CARGO_TARGET_DIR:?set a WSL-local CARGO_TARGET_DIR}"
export CARGO_BUILD_JOBS=2
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 OUTPUT_DIRECTORY" >&2
    exit 2
fi
mkdir -p "$1"
out=$(cd "$1" && pwd)
cargo near build reproducible-wasm --manifest-path contracts/token/Cargo.toml --out-dir "$out"
sha256sum "$out/token.wasm"
