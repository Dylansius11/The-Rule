#!/usr/bin/env bash
# This checks bytes only. Hosting and upload are pending D28.
set -euo pipefail
if [ "$#" -ne 1 ] && [ "$#" -ne 3 ]; then
    echo "Usage: $0 FILE.wasm [--verify-url https://HOST/PATH]" >&2
    exit 2
fi
file=$1
[ -f "$file" ] || { echo "Not a file: $file" >&2; exit 1; }
if [ "$#" -eq 3 ]; then
    [ "$2" = --verify-url ] && [[ "$3" == https://* ]] || {
        echo 'Expected --verify-url followed by an HTTPS URL' >&2; exit 2;
    }
fi
size=$(wc -c < "$file")
hash=$(sha256sum "$file" | cut -d ' ' -f 1)
printf 'SHA-256: %s\nSize: %s bytes\n' "$hash" "$size"
if [ "$size" -ge 10485760 ]; then
    echo 'Artifact must be under 10 MiB' >&2; exit 1
fi
if [ "$#" -eq 3 ]; then
    downloaded=$(mktemp)
    trap 'rm -f "$downloaded"' EXIT
    curl --fail --silent --show-error --location --max-redirs 3 \
        --proto '=https' --proto-redir '=https' --output "$downloaded" "$3"
    remote_hash=$(sha256sum "$downloaded" | cut -d ' ' -f 1)
    [ "$hash" = "$remote_hash" ] || { echo 'URL bytes do not match' >&2; exit 1; }
    echo 'URL SHA-256 matches the local artifact.'
fi
