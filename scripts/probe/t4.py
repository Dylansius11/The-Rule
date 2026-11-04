import base64
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

url, digest = sys.argv[1:3]
out = pathlib.Path('scratch/probe')
out.mkdir(parents=True, exist_ok=True)

def call(seed):
    args = json.dumps({'round': 2, 'seed': seed, 'url': url, 'hash': digest})
    command = ['near-rule','contract','call-function','as-transaction','probe-game.therule.testnet','probe','json-args',args,'prepaid-gas','200 Tgas','attached-deposit','0 NEAR','sign-as','probe-game.therule.testnet','network-config','testnet','sign-with-legacy-keychain','send']
    started = time.monotonic()
    result = subprocess.run(command, text=True, capture_output=True)
    output = re.sub(r'ed25519:[1-9A-HJ-NP-Za-km-z]+', '[redacted]', result.stdout + result.stderr)
    (out / (seed + '.log')).write_text(output)
    if result.returncode:
        raise RuntimeError(f'{seed} transaction failed: {output}')
    args64 = base64.b64encode(json.dumps({'round':2,'seed':seed}).encode()).decode()
    request = urllib.request.Request('https://rpc.testnet.near.org/', json.dumps({'jsonrpc':'2.0','id':'probe','method':'query','params':{'request_type':'call_function','finality':'final','account_id':'probe-game.therule.testnet','method_name':'get_probe','args_base64':args64}}).encode(), {'Content-Type':'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        obj = json.load(response)
    if 'result' not in obj:
        raise RuntimeError(str(obj))
    value = json.loads(bytes(obj['result']['result']))
    if not value or 'digest' not in value['result']:
        raise RuntimeError(f'{seed}: callback failed or absent: {value}')
    tx = re.search(r'Transaction ID:\s*(\S+)',output)
    event = re.search(r'EVENT_JSON:(\{"standard":"near-outlayer"[^\n]*"event":"execution_completed"[^\n]*\})',output)
    row = {'seed':seed,'tx':tx.group(1) if tx else None,'seconds':(int(value['finished_ns'])-int(value['started_ns']))/1e9,'wall_seconds':time.monotonic()-started,'callback':value,'event':json.loads(event.group(1)) if event else None}
    (out / (seed + '.json')).write_text(json.dumps(row, indent=2))
    print(json.dumps({'seed':seed,'tx':row['tx'],'seconds':row['seconds']}),flush=True)
    return row

rows = []
for i in range(int(sys.argv[3]) if len(sys.argv) > 3 else 0, 20):
    rows.append(call(f'seq-{i:02d}'))
(out/'t4-sequential.json').write_text(json.dumps(rows,indent=2))
