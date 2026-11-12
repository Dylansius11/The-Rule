#!/usr/bin/env python3
"""P8.2 production deploy and key-deletion ceremony (testnet only).

Commands (ceremony config JSON first, never put secrets in it):
  plan       offline: validate the production deploy plan and print the ordered steps
  preflight  read-only RPC and HTTP checks before anything is sent
  keys       read-only: list the access keys of one account
  execute    --step deploy | delete-keys; sends transactions only with --execute and the exact --confirm phrase
  verify     read-only: empty key lists, deployed code hash, params and first-slot timing; writes evidence

Key deletion is irreversible. It is a separate step that runs only after deploy, registration and
the live code/params checks pass. Evidence goes to scratch/ceremony/evidence.json.
"""
import argparse
import base64
import hashlib
import json
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/deploy'))
from rehearsal import amount, prepare, require  # noqa: E402

OUT = ROOT / 'scratch/ceremony'
TWO_HOURS_NS = 7_200_000_000_000
GENESIS_MARGIN_NS = 600_000_000_000  # deploy takes minutes; the first slot must still be 2 h away at init
TX_ID = re.compile(r'Transaction ID: *([A-Za-z0-9]{43,44})')
USER_AGENT = 'the-rule-ceremony/1'  # public RPCs such as drpc answer 403 to Python's default user agent


class RpcError(Exception):
    def __init__(self, name, detail):
        super().__init__(f'{name}: {detail}')
        self.name = name


class Rpc:
    """Sequential JSON-RPC client; an unreachable or rate-limited endpoint falls over to the next."""

    def __init__(self, urls, post=None, block=None):
        self.urls = urls
        self.post = post or self._post
        self.block = block
        self.n = 0

    @staticmethod
    def _post(url, payload):
        request = urllib.request.Request(url, json.dumps(payload).encode(), {'content-type': 'application/json', 'user-agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())

    def call(self, method, params):
        last = None
        for url in self.urls:
            self.n += 1
            try:
                body = self.post(url, {'jsonrpc': '2.0', 'id': str(self.n), 'method': method, 'params': params})
            except (OSError, ValueError, urllib.error.URLError) as error:
                last = f'{url}: {error}'
                continue
            if 'error' in body:
                err = body['error']
                cause = (err.get('cause') or {}).get('name') or err.get('name') or 'RPC_ERROR'
                raise RpcError(cause, err.get('data') or err.get('message') or '')
            result = body['result']
            if isinstance(result, dict) and isinstance(result.get('error'), str):
                raise RpcError('QUERY_ERROR', result['error'])
            return result
        raise RpcError('UNREACHABLE', last or 'no RPC endpoint configured')

    def query(self, request_type, **fields):
        selector = {'block_id': self.block['hash']} if self.block else {'finality': 'final'}
        result = self.call('query', {'request_type': request_type, **selector, **fields})
        if self.block and (result.get('block_hash') != self.block['hash']
                           or result.get('block_height') != self.block['height']):
            raise RpcError('BLOCK_MISMATCH', f'{request_type} returned a block other than '
                           f'{self.block["hash"]} at height {self.block["height"]}')
        return result


def account_state(rpc, account_id):
    try:
        return rpc.query('view_account', account_id=account_id)
    except RpcError as error:
        if error.name == 'UNKNOWN_ACCOUNT':
            return None
        raise


def access_keys(rpc, account_id):
    result = rpc.query('view_access_key_list', account_id=account_id)
    return {'block_hash': result['block_hash'], 'block_height': result['block_height'],
            'keys': sorted(k['public_key'] for k in result['keys'])}


def code_sha256(rpc, account_id):
    return hashlib.sha256(base64.b64decode(rpc.query('view_code', account_id=account_id)['code_base64'])).hexdigest()


def view_json(rpc, account_id, method, args):
    raw = rpc.query('call_function', account_id=account_id, method_name=method,
                    args_base64=base64.b64encode(json.dumps(args).encode()).decode())['result']
    return json.loads(bytes(raw))


def final_block(rpc):
    header = rpc.call('block', {'finality': 'final'})['header']
    return {'hash': header['hash'], 'height': header['height'], 'timestamp_ns': int(header['timestamp_nanosec'])}


def load(config_path):
    config = json.loads(Path(config_path).read_text(encoding='utf-8'))
    require(isinstance(config, dict) and set(config) == {'deploy_config', 'rpc_urls', 'min_balance_yocto'}, 'ceremony config: expected deploy_config, rpc_urls, min_balance_yocto')
    require(isinstance(config['rpc_urls'], list) and 1 <= len(config['rpc_urls']) <= 3 and all(isinstance(u, str) and u.startswith('https://') for u in config['rpc_urls']), 'rpc_urls: one to three https URLs')
    balances = config['min_balance_yocto']
    require(isinstance(balances, dict) and set(balances) == {'game', 'token', 'payer'}, 'min_balance_yocto: expected game, token, payer')
    for name, value in balances.items():
        amount(value, 'min_balance_yocto.' + name, True)
    source = config['deploy_config']
    deploy = source if isinstance(source, dict) else json.loads(Path(source).read_text(encoding='utf-8'))
    require(deploy.get('deployment_kind') == 'production', 'deploy_config must have deployment_kind production')
    return config, deploy


def build_plan(deploy, now_ns):
    plan = prepare(deploy)
    genesis = deploy['params']['genesis_ns']
    require(genesis >= now_ns + TWO_HOURS_NS + GENESIS_MARGIN_NS,
            'genesis_ns must be at least 2 h plus 10 min after now, so it is still 2 h away when init runs')
    plan['expected_params'] = deploy['params']
    plan['accounts'] = {'game': deploy['game_account'], 'token': deploy['token_account']}
    return plan


def deletion_commands(keys_by_account):
    """One atomic transaction per account that deletes every key it holds, function-call keys included.

    A single transaction cannot lock the account halfway: the signing key is deleted together with the rest."""
    commands = []
    for account_id, keys in keys_by_account.items():
        if keys:
            commands.append(['near-rule', 'account', 'delete-keys', account_id, 'public-keys', ','.join(keys),
                             'network-config', 'testnet', 'sign-with-legacy-keychain', 'send'])
    return commands


def check_deployed(rpc, plan):
    """Return a list of human-readable problems; empty means the deployment matches the plan."""
    problems = []
    for name, account_id in plan['accounts'].items():
        state = account_state(rpc, account_id)
        if state is None:
            problems.append(f'{account_id}: account does not exist')
            continue
        actual = code_sha256(rpc, account_id)
        if actual != plan['sha256'][name]:
            problems.append(f'{account_id}: code sha256 {actual} != planned {plan["sha256"][name]}')
    if problems:
        return problems
    game, token = plan['accounts']['game'], plan['accounts']['token']
    live = view_json(rpc, game, 'get_params', {})
    # The contract adds fields the init params do not carry (demo, request limits), so compare the planned keys.
    differing = sorted(key for key, value in plan['expected_params'].items() if live.get(key) != value)
    if differing:
        problems.append(f'{game}: get_params differs from the plan in {", ".join(differing)}')
    if live.get('demo') is not False:
        problems.append(f'{game}: demo flag is not false')
    if view_json(rpc, token, 'storage_balance_of', {'account_id': game}) is None:
        problems.append(f'{token}: game is not registered for storage')
    return problems


def saved_plan():
    plan = json.loads((OUT / 'plan.json').read_text(encoding='utf-8'))
    require(plan.get('deployment_kind') == 'production' and plan.get('accounts') == {'game': 'game.therule.testnet', 'token': 'token.therule.testnet'}
            and {'sha256', 'expected_params'} <= set(plan), 'scratch/ceremony/plan.json is not a production plan; run plan first')
    return plan


def verify(rpc, plan):
    """Bind every observation to one final, pre-genesis block; never combine moving heads."""
    block = final_block(rpc)
    genesis = plan['expected_params']['genesis_ns']
    failures, accounts = [], {}
    if block['timestamp_ns'] >= genesis:
        failures.append('first round slot already passed; keys must be empty before it')
    else:
        snapshot = Rpc(rpc.urls, rpc.post, block)
        try:
            for account_id in plan['accounts'].values():
                listing = access_keys(snapshot, account_id)
                accounts[account_id] = listing
                if listing['keys']:
                    failures.append(f'{account_id}: {len(listing["keys"])} access key(s) remain')
            failures += check_deployed(snapshot, plan)
        except RpcError as error:
            failures.append(str(error))
    return {'block': block, 'genesis_ns': genesis, 'accounts': accounts, 'failures': failures}, failures


def require_deletion_window(rpc, plan, headroom_seconds):
    block = final_block(rpc)
    deadline = plan['expected_params']['genesis_ns'] - headroom_seconds * 1_000_000_000
    require(block['timestamp_ns'] < deadline,
            f'keys kept: final block time {block["timestamp_ns"]} must be strictly before '
            f'genesis minus deletion headroom ({headroom_seconds} s), deadline {deadline}')
    return block


def preflight(rpc, plan, deploy, config, fetch):
    problems = []
    if rpc.call('status', [])['chain_id'] != 'testnet':
        problems.append('RPC chain is not testnet')
    wanted = {'game': config['min_balance_yocto']['game'], 'token': config['min_balance_yocto']['token'],
              'payer': config['min_balance_yocto']['payer']}
    for name, account_id in (('game', deploy['game_account']), ('token', deploy['token_account']), ('payer', deploy['registration_payer'])):
        state = account_state(rpc, account_id)
        if state is None:
            problems.append(f'{account_id}: account does not exist (create and fund it first)')
            continue
        if name != 'payer' and state['code_hash'] != '11111111111111111111111111111111':
            problems.append(f'{account_id}: already holds code; ceremony needs an empty account')
        if int(state['amount']) < int(wanted[name]):
            problems.append(f'{account_id}: balance {state["amount"]} below required {wanted[name]}')
    for url in deploy['params']['referee']['urls']:
        try:
            digest = hashlib.sha256(fetch(url)).hexdigest()
        except (OSError, ValueError) as error:
            problems.append(f'{url}: not fetchable ({error})')
            continue
        if digest != deploy['referee_sha256']:
            problems.append(f'{url}: served sha256 {digest} != {deploy["referee_sha256"]}')
    return problems


def http_get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': USER_AGENT}), timeout=60) as response:
        return response.read(10 * 1024 * 1024 + 1)


def write_evidence(update):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / 'evidence.json'
    data = json.loads(path.read_text()) if path.exists() else {}
    data.update(update)
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def confirm_phrase(step, plan):
    return f'{step} {plan["accounts"]["game"]} {plan["accounts"]["token"]}'


def run_commands(commands, evidence_key, before_each=None):
    done = []
    for command in commands:
        if before_each:
            before_each()
        proc = subprocess.run(command, capture_output=True, text=True)
        found = TX_ID.findall(proc.stdout + proc.stderr)
        done.append({'command': shlex.join(command)[:200], 'returncode': proc.returncode, 'tx': found[-1] if found else None})
        write_evidence({evidence_key: done})
        if proc.returncode != 0:
            raise RuntimeError(f'command failed ({proc.returncode}): {" ".join(command[:4])}\n{(proc.stderr or proc.stdout)[-800:]}')
        print(f'ok: {" ".join(command[:5])} tx={found[-1] if found else "unknown"}', flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('config')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('plan')
    sub.add_parser('preflight')
    sub.add_parser('verify')
    keys = sub.add_parser('keys')
    keys.add_argument('account')
    execute = sub.add_parser('execute')
    execute.add_argument('--step', choices=('deploy', 'delete-keys'), required=True)
    execute.add_argument('--execute', action='store_true', help='actually send; without it the step only prints')
    execute.add_argument('--confirm', default='')
    execute.add_argument('--deletion-headroom-seconds', type=int, default=600,
                         help='positive safety headroom before genesis for each deletion dispatch (default 600)')
    args = parser.parse_args(argv)
    if args.command == 'execute':
        require(args.deletion_headroom_seconds > 0, 'deletion headroom must be positive')
    config, deploy = load(args.config)
    rpc = Rpc(config['rpc_urls'])
    if args.command == 'keys':
        print(json.dumps(access_keys(rpc, args.account), indent=2))
        return 0
    if args.command == 'verify' or (args.command == 'execute' and args.step == 'delete-keys'):
        # After the deploy the first slot is under 2 h away, so the planner's schedule bound no longer
        # holds. The saved plan is compared with the live chain instead.
        plan = saved_plan()
    else:
        plan = build_plan(deploy, time.time_ns())
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')
    if args.command == 'plan':
        print(plan['label'])
        for i, command in enumerate(plan['commands'], 1):
            print(f'{i}. {shlex.join(command)[:160]}')
        print(f'{len(plan["commands"]) + 1}. execute --step delete-keys deletes EVERY access key of both accounts. IRREVERSIBLE.')
        print(f'{len(plan["commands"]) + 2}. verify proves empty key lists before the first slot.')
        print('OFFLINE: plan written to scratch/ceremony/plan.json; no network, signature or transaction.')
        return 0
    if args.command == 'preflight':
        problems = preflight(rpc, plan, deploy, config, http_get)
        print('\n'.join(problems) if problems else 'PREFLIGHT PASS')
        return 1 if problems else 0
    if args.command == 'verify':
        record, failures = verify(rpc, plan)
        write_evidence({'verify': record})
        for account_id, listing in record['accounts'].items():
            print(f'{account_id}: {len(listing["keys"])} key(s) at block {listing["block_height"]}')
        print('FAIL\n' + '\n'.join(failures) if failures else 'PASS: empty key lists, planned code and params, first slot still ahead. This does not prove the rule stayed secret.')
        return 1 if failures else 0
    phrase = confirm_phrase(args.step, plan)
    if args.step == 'deploy':
        commands = plan['commands']
        if args.execute:
            require(args.confirm == phrase, f'refusing: pass --confirm "{phrase}"')
            problems = preflight(rpc, plan, deploy, config, http_get)
            require(not problems, 'preflight failed:\n' + '\n'.join(problems))
    else:
        listing = {a: access_keys(rpc, a)['keys'] for a in plan['accounts'].values()}
        commands = deletion_commands(listing)
        if args.execute:
            require(args.confirm == phrase, f'refusing: pass --confirm "{phrase}"')
            problems = check_deployed(rpc, plan)
            require(not problems, 'deployment does not match the plan; keys kept:\n' + '\n'.join(problems))
            write_evidence({'keys_before_deletion': listing})
    for command in commands:
        print(shlex.join(command)[:200])
    if not args.execute:
        print(f'DRY RUN: nothing sent. To send, add --execute --confirm "{phrase}"')
        return 0
    if args.step == 'delete-keys':
        require_deletion_window(rpc, plan, args.deletion_headroom_seconds)
        run_commands(commands, 'delete_key_txs',
                     before_each=lambda: require_deletion_window(rpc, plan, args.deletion_headroom_seconds))
    else:
        run_commands(commands, 'deploy_txs')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, RuntimeError, RpcError, subprocess.SubprocessError) as error:
        print(f'ceremony: {error}', file=sys.stderr)
        sys.exit(1)
