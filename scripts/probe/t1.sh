#!/usr/bin/env bash
set -euo pipefail
: "${REFEREE_URL:?set REFEREE_URL}"
: "${REFEREE_HASH:?set REFEREE_HASH}"
python3 scripts/probe/t1.py "$REFEREE_URL" "$REFEREE_HASH"
