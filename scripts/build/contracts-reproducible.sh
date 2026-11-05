#!/usr/bin/env bash
# cargo-near builds committed Git sources, including the committed workspace lockfile.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
: "${XDG_CONFIG_HOME:?set XDG_CONFIG_HOME to the project-specific config directory}"
export CARGO_BUILD_JOBS=2
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 OUTPUT_DIRECTORY" >&2
    exit 2
fi
# A missing local engine is a prerequisite failure, never a successful build.
if ! docker info; then
    echo "A working Docker client and Linux engine inside WSL are required; no artifacts were built." >&2
    exit 1
fi
mkdir -p "$1"
out=$(cd "$1" && pwd)
printf 'Committed source: %s\n' "$(git rev-parse HEAD)"
for contract in game token; do
    # Host target overrides can make cargo-near copy an old local artifact after a fresh Docker build.
    env -u CARGO_TARGET_DIR cargo near build reproducible-wasm --manifest-path "contracts/$contract/Cargo.toml" --out-dir "$out/$contract"
    sha256sum "$out/$contract/$contract.wasm"
done
