import base64
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

url, digest = sys.argv[1:3]
out = pathlib.Path('scratch/probe')
args = json.dumps({'round':4,'url':url,'hash':digest})
cmd = ['near-rule','contract','call-function','as-transaction','probe-game.therule.testnet','probe_batch','json-args',args,'prepaid-gas','900 Tgas','attached-deposit','0 NEAR','sign-as','probe-game.therule.testnet','network-config','testnet','sign-with-legacy-keychain','send']
result = subprocess.run(cmd,capture_output=True,text=True)
text = re.sub(r'ed25519:[1-9A-HJ-NP-Za-km-z]+','[redacted]',result.stdout+result.stderr)
(out/'t4-parallel.log').write_text(text)
if result.returncode:
    raise RuntimeError(text)
rows = []
for i in range(10):
    seed=f'batch-{i}'
    b64=base64.b64encode(json.dumps({'round':4,'seed':seed}).encode()).decode()
    body=json.dumps({'jsonrpc':'2.0','id':'t4','method':'query','params':{'request_type':'call_function','finality':'final','account_id':'probe-game.therule.testnet','method_name':'get_probe','args_base64':b64}}).encode()
    for attempt in range(40):
        req=urllib.request.Request('https://rpc.testnet.near.org/',body,{'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=30) as response:
            obj=json.load(response)
        value=json.loads(bytes(obj['result']['result']))
        if value is not None:
            break
        time.sleep(3)
    if not value:
        raise RuntimeError(f'{seed}: callback not found')
    rows.append({'seed':seed,'seconds':(int(value['finished_ns'])-int(value['started_ns']))/1e9,'callback':value})
(out/'t4-parallel.json').write_text(json.dumps(rows,indent=2))
print('transaction',re.search(r'Transaction ID:\s*(\S+)',text).group(1))
print(json.dumps(rows,indent=2))
durations=sorted(row['seconds'] for row in rows)
print('p95 nearest-rank',durations[9], 'seconds')
if any('failure' in row['callback']['result'] for row in rows) or durations[9] > 60:
    raise SystemExit('T4 gate: failure or p95 above 60s')
