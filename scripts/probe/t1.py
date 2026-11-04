import base64
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

url, digest = sys.argv[1:]
outputs = []
for i, seed in enumerate(('t1-a','t1-a','t1-b')):
    args=json.dumps({'round':1,'seed':seed,'url':url,'hash':digest})
    cmd=['near-rule','contract','call-function','as-transaction','probe-game.therule.testnet','probe','json-args',args,'prepaid-gas','200 Tgas','attached-deposit','0 NEAR','sign-as','probe-game.therule.testnet','network-config','testnet','sign-with-legacy-keychain','send']
    p=subprocess.run(cmd,text=True,capture_output=True)
    log=re.sub(r'ed25519:[1-9A-HJ-NP-Za-km-z]+','[redacted]',p.stdout+p.stderr)
    pathlib.Path(f'scratch/probe/t1-{i}.log').write_text(log)
    if p.returncode:
        raise RuntimeError(log)
    args64=base64.b64encode(json.dumps({'round':1,'seed':seed}).encode()).decode()
    body=json.dumps({'jsonrpc':'2.0','id':'t1','method':'query','params':{'request_type':'call_function','finality':'final','account_id':'probe-game.therule.testnet','method_name':'get_probe','args_base64':args64}}).encode()
    req=urllib.request.Request('https://rpc.testnet.near.org/',body,{'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as response:
        result=json.load(response)
    value=json.loads(bytes(result['result']['result']))
    if not value or 'digest' not in value['result']:
        raise RuntimeError(f'No valid digest: {value}')
    outputs.append(value['result']['digest'])
    print('transaction',re.search(r'Transaction ID:\s*(\S+)',log).group(1),'digest',outputs[-1])
if outputs[0] != outputs[1] or outputs[0] == outputs[2]:
    raise RuntimeError('T1 failed: digest comparison')
print('T1 PASS')
