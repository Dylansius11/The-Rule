#!/usr/bin/env bash
set -euo pipefail
: "${REFEREE_URL:?set REFEREE_URL}"
: "${REFEREE_HASH:?set REFEREE_HASH}"
args=$(python3 -c 'import json,sys; print(json.dumps({"source":{"WasmUrl":{"url":sys.argv[1],"hash":sys.argv[2],"build_target":"wasm32-wasip2"}},"resource_limits":{"max_instructions":1000000000,"max_memory_mb":128,"max_execution_seconds":60},"input_data":json.dumps({"op":"derive","round":1,"seed":"t1-a"}),"response_format":"Json"}))' "$REFEREE_URL" "$REFEREE_HASH")
redact() { python3 -c 'import re,sys; print(re.sub(r"ed25519:[1-9A-HJ-NP-Za-km-z]+", "[redacted]", sys.stdin.read()),end="")'; }
check_denial() { python3 -c 'from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
if "Nothing was executed." not in text or "instructions: 0, time_ms: 0" not in text or "\nnull\n" not in text:
    raise SystemExit("T2 failed: " + sys.argv[1])' "$1"; }
python3 scripts/probe/second-proxy.py "$REFEREE_URL" "$REFEREE_HASH" scratch/probe/second.wat
"${WASM_TOOLS:?set WASM_TOOLS}" parse scratch/probe/second.wat -o scratch/probe/second.wasm
near-rule contract deploy probe-other.therule.testnet use-file scratch/probe/second.wasm without-init-call network-config testnet sign-with-legacy-keychain send 2>&1 | redact
near-rule contract call-function as-transaction outlayer.testnet request_execution json-args "$args" prepaid-gas '200 Tgas' attached-deposit '0.0070001 NEAR' sign-as probe-other.therule.testnet network-config testnet sign-with-legacy-keychain send 2>&1 | redact | tee scratch/probe/t2-direct.log
check_denial scratch/probe/t2-direct.log
near-rule contract call-function as-transaction probe-other.therule.testnet probe json-args '{}' prepaid-gas '200 Tgas' attached-deposit '0 NEAR' sign-as keeper.therule.testnet network-config testnet sign-with-legacy-keychain send 2>&1 | redact | tee scratch/probe/t2-contract.log
check_denial scratch/probe/t2-contract.log
echo 'T2 PASS'
