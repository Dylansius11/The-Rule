#!/usr/bin/env bash
set -euo pipefail
: "${MUTATED_URL:?set MUTATED_URL}"
: "${MUTATED_HASH:?set MUTATED_HASH}"
: "${BASE_DIGEST:?set BASE_DIGEST from the unmodified referee for round 1, seed t1-a}"
args=$(python3 -c 'import json,sys; print(json.dumps({"round":1,"seed":"t1-a","url":sys.argv[1],"hash":sys.argv[2]}))' "$MUTATED_URL" "$MUTATED_HASH")
near-rule contract call-function as-transaction probe-game.therule.testnet probe json-args "$args" prepaid-gas '200 Tgas' attached-deposit '0 NEAR' sign-as probe-game.therule.testnet network-config testnet sign-with-legacy-keychain send 2>&1 | python3 -c 'import re,sys; print(re.sub(r"ed25519:[1-9A-HJ-NP-Za-km-z]+", "[redacted]", sys.stdin.read()),end="")'
python3 -c 'import base64,json,sys,urllib.request
arg=base64.b64encode(b"{\"round\":1,\"seed\":\"t1-a\"}").decode()
body=json.dumps({"jsonrpc":"2.0","id":"t3","method":"query","params":{"request_type":"call_function","finality":"final","account_id":"probe-game.therule.testnet","method_name":"get_probe","args_base64":arg}}).encode()
req=urllib.request.Request("https://rpc.testnet.near.org/",body,{"Content-Type":"application/json"})
with urllib.request.urlopen(req,timeout=30) as r: value=json.loads(bytes(json.load(r)["result"]["result"]))
result=value.get("result",value)
if "digest" not in result or result["digest"] == sys.argv[1]: raise SystemExit(f"T3 failed: {value}")
print("T3 PASS",result["digest"])' "$BASE_DIGEST"
