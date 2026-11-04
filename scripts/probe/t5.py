import base64
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

url, digest, trap_url, trap_hash = sys.argv[1:5]
out = pathlib.Path('scratch/probe')
limits = {'max_instructions':1000000000,'max_memory_mb':128,'max_execution_seconds':60}
cases = [
    ('bad-input',url,digest,'{}',limits),
    ('guest-trap',trap_url,trap_hash,'{}',limits),
    ('impossible-limit',url,digest,'{"op":"derive","round":3,"seed":"failure"}',dict(limits,max_instructions=500000000001)),
]
for name, case_url, case_hash, guest_input, case_limits in cases:
    args = json.dumps({'round':3,'seed':name,'url':case_url,'hash':case_hash,'input':guest_input,'limits':case_limits})
    cmd = ['near-rule','contract','call-function','as-transaction','probe-game.therule.testnet','probe_failure','json-args',args,'prepaid-gas','200 Tgas','attached-deposit','0 NEAR','sign-as','probe-game.therule.testnet','network-config','testnet','sign-with-legacy-keychain','send']
    result = subprocess.run(cmd,capture_output=True,text=True)
    text = re.sub(r'ed25519:[1-9A-HJ-NP-Za-km-z]+','[redacted]',result.stdout+result.stderr)
    (out / (name+'.log')).write_text(text)
    if result.returncode:
        raise RuntimeError(f'{name} failed: {text}')
    b64 = base64.b64encode(json.dumps({'round':3,'seed':name}).encode()).decode()
    payload = json.dumps({'jsonrpc':'2.0','id':'t5','method':'query','params':{'request_type':'call_function','finality':'final','account_id':'probe-game.therule.testnet','method_name':'get_probe','args_base64':b64}}).encode()
    request = urllib.request.Request('https://rpc.testnet.near.org/',payload,{'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=30) as response:
        obj = json.load(response)
    value = json.loads(bytes(obj['result']['result']))
    if not value or 'failure' not in value['result']:
        raise RuntimeError(f'{name}: expected failure, got {value}')
    tx = re.search(r'Transaction ID:\s*(\S+)',text)
    row = {'case':name,'transaction':tx.group(1) if tx else None,'callback':value}
    (out/(name+'.json')).write_text(json.dumps(row,indent=2))
    print(json.dumps(row),flush=True)
