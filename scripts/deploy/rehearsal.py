#!/usr/bin/env python3
"""Prepare or explicitly execute a testnet-only, key-retaining rehearsal."""
import argparse
import hashlib
import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
OPS = ("begin", "verdict", "guess", "open")
AMOUNTS = ("play_fee", "storage_charge_per_play", "storage_charge_account", "storage_charge_team", "stake_min", "round_allowance", "mint_base")
U64 = ("genesis_ns", "round_period_ns", "investigation_max_ns", "reveal_window_ns", "begin_timeout_ns", "open_timeout_ns", "min_reveal_delay_blocks", "gas_outlayer", "gas_callback", "gas_mint")
ARRAYS = {"fee_split_bps": (3, 16), "stake_bps": (2, 16), "solved_split_bps": (4, 16), "unsolved_split_bps": (3, 16), "mode_offset_ns": (2, 64), "base_attempts": (2, 16), "attempt_cap": (2, 16), "share_cap": (2, 16)}
PARAM_KEYS = set(AMOUNTS + U64) | set(ARRAYS) | {"wrong_return_bps", "lock_tiers", "max_team_size", "referee", "resource_limits", "outlayer_deposit", "token", "platform", "chain_id"}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def obj(value, keys, name):
    require(isinstance(value, dict) and set(value) == set(keys), f"{name}: expected exactly {sorted(keys)}")
    return value


def uint(value, bits, name, positive=False):
    require(type(value) is int and (1 if positive else 0) <= value < 2**bits, f"{name}: invalid u{bits}")


def amount(value, name, positive=False):
    require(isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value) is not None and int(value) < 2**128 and (not positive or int(value) > 0), f"{name}: expected {'positive ' if positive else ''}u128 decimal string")


def account(value, name):
    require(isinstance(value, str) and 2 <= len(value) <= 64 and value.endswith('.testnet') and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', value) is not None, f"{name}: expected testnet account ID")


def artifact(value, name):
    require(isinstance(value, str) and value, f"{name}: missing path")
    path = Path(value).resolve(strict=True)
    require(path.is_file(), f"{name}: not a file")
    data = path.read_bytes()
    require(len(data) > 8 and data.startswith(b'\0asm'), f"{name}: not a wasm artifact")
    return path, data


def referee_manifest(data):
    """Read the sole manifest custom section, not copies in program data.

    This validates section boundaries in core modules/components, not the full WASM instruction set.
    """
    def leb(pos, end):
        value = 0
        for shift in range(0, 35, 7):
            require(pos < end, 'referee: truncated section length')
            byte = data[pos]
            pos += 1
            require(shift < 28 or byte < 16, 'referee: invalid section length')
            value |= (byte & 127) << shift
            if byte < 128:
                return value, pos
        raise ValueError('referee: invalid section length')

    manifests, pending = [], [(0, len(data), 0)]
    while pending:
        start, end, depth = pending.pop()
        require(depth <= 32, 'referee: excessive component nesting')
        header = data[start:start + 8]
        require(end - start >= 8 and header in (b'\0asm\x01\0\0\0', b'\0asm\x0d\0\x01\0'), 'referee: invalid module/component header')
        component = header == b'\0asm\x0d\0\x01\0'
        pos = start + 8
        while pos < end:
            kind = data[pos]
            size, payload = leb(pos + 1, end)
            section_end = payload + size
            require(section_end <= end, 'referee: truncated section payload')
            if kind == 0:
                length, name = leb(payload, section_end)
                name_end = name + length
                require(name_end <= section_end, 'referee: truncated custom section name')
                if data[name:name_end] == b'outlayer.manifest':
                    manifests.append(data[name_end:section_end].strip())
            elif component and kind in (1, 4):
                pending.append((payload, section_end, depth + 1))
            pos = section_end
    require(len(manifests) == 1, 'referee must have exactly one outlayer.manifest custom section')
    return manifests[0]


def prepare(config):
    obj(config, ("network", "game_account", "token_account", "game_wasm", "token_wasm", "referee_wasm", "referee_sha256", "referee_build_log", "token_cap", "token_metadata", "demo", "params", "init_gas", "token_storage_deposit", "registration_payer", "registration_gas", "token_operation_funding", "operation_funding_payer", "operation_funding_gas"), 'config')
    require(config['network'] == 'testnet', 'network must be testnet')
    game, token = config['game_account'], config['token_account']
    account(game, 'game_account'); account(token, 'token_account')
    require(game != token, 'game and token must be different accounts')
    account(config['registration_payer'], 'registration_payer')
    amount(config['token_storage_deposit'], 'token_storage_deposit', True)
    uint(config['registration_gas'], 64, 'registration_gas', True)
    account(config['operation_funding_payer'], 'operation_funding_payer')
    amount(config['token_operation_funding'], 'token_operation_funding', True)
    uint(config['operation_funding_gas'], 64, 'operation_funding_gas', True)
    require(config['operation_funding_gas'] <= 300_000_000_000_000, 'operation_funding_gas exceeds 300 Tgas')
    require(config['registration_gas'] <= 300_000_000_000_000, 'registration_gas exceeds 300 Tgas')
    paths, blobs = {}, {}
    for name in ('game', 'token', 'referee'):
        paths[name], blobs[name] = artifact(config[name + '_wasm'], name + '_wasm')
    digest = hashlib.sha256(blobs['referee']).hexdigest()
    require(isinstance(config['referee_sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', config['referee_sha256']) and digest == config['referee_sha256'], 'referee sha256 mismatch or invalid')
    # build.rs embeds this exact source manifest with the bound game substituted.
    template = (ROOT / 'enclave/referee/manifest.json').read_text().strip()
    require(isinstance(config['referee_build_log'], str) and config['referee_build_log'], 'referee_build_log is required')
    build_log = Path(config['referee_build_log']).read_text(encoding='utf-8')
    callers = re.findall(r'^Caller: ([^\r\n]+)\r?$', build_log, re.MULTILINE)
    hashes = re.findall(r'^([0-9a-f]{64})[ \t]+(?:\*?)[^\r\n]+$', build_log, re.MULTILINE)
    require(callers == [game] and hashes == [digest], 'referee build log must record exactly this caller and sha256')
    manifest = template.replace('<GAME_ACCOUNT_PLACEHOLDER>', game).encode()
    require(len(blobs['referee']) < 10 * 1024 * 1024, 'referee exceeds OutLayer size limit')
    require(referee_manifest(blobs['referee']) == manifest, 'referee embedded build manifest does not bind this game')
    require(b'RULE_DEMO' not in blobs['referee'], 'demo referee bytes are not allowed for this rehearsal')
    amount(config['token_cap'], 'token_cap', True)
    require(re.fullmatch(r'game-r[1-9][0-9]*\.therule\.testnet', game) is not None and token == game.replace('game-r', 'token-r', 1), 'rehearsal accounts must be matching game-rN/token-rN.therule.testnet')
    metadata = obj(config['token_metadata'], ('spec', 'name', 'symbol', 'decimals'), 'token_metadata')
    require(metadata['spec'] == 'ft-1.0.0' and isinstance(metadata['name'], str) and bool(metadata['name']) and metadata['symbol'] == 'RULE' and metadata['decimals'] == 18, 'invalid token metadata')
    require(type(config['demo']) is bool, 'demo must be boolean')
    uint(config['init_gas'], 64, 'init_gas', True)
    require(config['init_gas'] <= 300_000_000_000_000, 'init_gas exceeds 300 Tgas')
    p = obj(config['params'], PARAM_KEYS, 'params')
    require(p['chain_id'] == 'testnet' and p['token'] == token, 'params chain/token mismatch')
    account(p['platform'], 'platform')
    for key in AMOUNTS:
        amount(p[key], key, key == 'round_allowance')
    for key in U64:
        uint(p[key], 64, key, key in ('round_period_ns', 'gas_outlayer', 'gas_callback', 'gas_mint'))
    require(p['gas_callback'] >= 60_000_000_000_000 and p['gas_outlayer'] >= 100_000_000_000_000 and p['gas_mint'] >= 10_000_000_000_000 and p['gas_outlayer'] + p['gas_callback'] <= 250_000_000_000_000 and p['gas_mint'] + p['gas_callback'] <= 250_000_000_000_000, 'invalid game gas limits')
    require(int(p['mint_base']) <= int(p['round_allowance']), 'mint_base exceeds round_allowance')
    for key, (length, bits) in ARRAYS.items():
        require(isinstance(p[key], list) and len(p[key]) == length, f'{key}: invalid array')
        for n in p[key]: uint(n, bits, key)
    uint(p['wrong_return_bps'], 16, 'wrong_return_bps')
    uint(p['max_team_size'], 8, 'max_team_size')
    require(isinstance(p['lock_tiers'], list) and len(p['lock_tiers']) <= 3, 'lock_tiers must contain at most three tiers')
    require(1 <= p['max_team_size'] <= 5, 'max_team_size must be between one and five')
    for tier in p['lock_tiers']:
        obj(tier, ('amount', 'extra_attempts'), 'lock tier'); amount(tier['amount'], 'lock tier amount'); uint(tier['extra_attempts'], 16, 'extra_attempts')
    require(sum(p['fee_split_bps']) == sum(p['solved_split_bps']) == sum(p['unsolved_split_bps']) == 10000 and p['wrong_return_bps'] <= 10000 and max(p['stake_bps']) <= 10000, 'invalid splits')
    require(all(p['base_attempts']) and all(p['share_cap']) and all(a >= b for a, b in zip(p['attempt_cap'], p['base_attempts'])) and int(p['round_allowance']) < 2**127 and int(p['play_fee']) + int(p['storage_charge_per_play']) < 2**128, 'invalid game bounds')
    if not config['demo']:
        byte_cost = 10_000_000_000_000_000_000  # Current protocol price; on-chain init rechecks its actual runtime price.
        require(int(p['storage_charge_account']) >= 512 * byte_cost and int(p['storage_charge_per_play']) >= 2048 * byte_cost and int(p['storage_charge_team']) >= 2048 * byte_cost, 'production storage charges below lifetime record budgets')
        require(p['genesis_ns'] >= time.time_ns() + 7_200_000_000_000 and p['round_period_ns'] >= 3_600_000_000_000 and min(p['reveal_window_ns'], p['begin_timeout_ns'], p['open_timeout_ns']) >= 600_000_000_000, 'non-demo schedule violates deployment bounds')
    ref = obj(p['referee'], ('outlayer', 'urls', 'hash', 'build_target'), 'referee')
    require(ref['outlayer'] == 'outlayer.testnet' and ref['hash'] == digest and ref['build_target'] == 'wasm32-wasip2', 'referee configuration mismatch')
    require(isinstance(ref['urls'], list) and 1 <= len(ref['urls']) <= 2, 'one or two referee URLs required')
    for url in ref['urls']:
        require(isinstance(url, str) and len(url.encode('utf-8')) <= 2048, 'referee URL exceeds 2048 bytes')
        u = urlsplit(url)
        require(u.scheme == 'https' and bool(u.hostname) and u.username is None and u.password is None and u.port in (None, 443) and not u.fragment and not any(c.isspace() for c in url), 'referee URL must be HTTPS on port 443 without credentials or fragment')
    for key in ('resource_limits', 'outlayer_deposit'):
        obj(p[key], OPS, key)
    for op in OPS:
        limits = obj(p['resource_limits'][op], ('instructions', 'memory_mb', 'execution_seconds'), op + ' limits')
        for k, bits in (('instructions', 64), ('memory_mb', 32), ('execution_seconds', 32)):
            uint(limits[k], bits, op + ' ' + k, True)
        amount(p['outlayer_deposit'][op], op + ' deposit', True)
    token_args = {'minter': game, 'cap': config['token_cap'], 'metadata': metadata}
    game_args = {'params': p, 'demo': config['demo']}
    def command(name, args):
        return ['near-rule', 'contract', 'deploy', config[name + '_account'], 'use-file', str(paths[name]), 'with-init-call', 'new', 'json-args', json.dumps(args, separators=(',', ':')), 'prepaid-gas', str(config['init_gas']) + ' gas', 'attached-deposit', '0 NEAR', 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send']
    registration_args = {'account_id': game, 'registration_only': True}
    registration = ['near-rule', 'contract', 'call-function', 'as-transaction', token, 'storage_deposit', 'json-args', json.dumps(registration_args, separators=(',', ':')), 'prepaid-gas', str(config['registration_gas']) + ' gas', 'attached-deposit', config['token_storage_deposit'] + ' yoctoNEAR', 'sign-as', config['registration_payer'], 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send']
    funding = ['near-rule', 'contract', 'call-function', 'as-transaction', token, 'fund_operations', 'json-args', '{}', 'prepaid-gas', str(config['operation_funding_gas']) + ' gas', 'attached-deposit', config['token_operation_funding'] + ' yoctoNEAR', 'sign-as', config['operation_funding_payer'], 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send']
    return {'label': 'TESTNET REHEARSAL — KEYS RETAINED' + ('; compressed schedule; non-demo referee; no preselected rule' if config['demo'] else '; non-demo schedule'), 'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in blobs.items()}, 'token_init': token_args, 'game_init': game_args, 'game_token_registration': {'args': registration_args, 'deposit': config['token_storage_deposit'], 'payer': config['registration_payer']}, 'token_operation_funding': {'deposit': config['token_operation_funding'], 'payer': config['operation_funding_payer'], 'nonrefundable': True}, 'commands': [command('token', token_args), funding, command('game', game_args), registration]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', help='explicit JSON configuration; never include secrets')
    parser.add_argument('--execute', action='store_true', help='after founder authorization, send testnet deployments, token operation funding and game token registration')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding='utf-8'))
    plan = prepare(config)
    out = ROOT / 'scratch/deploy'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')
    (out / 'commands.sh').write_text('#!/usr/bin/env bash\nset -euo pipefail\n' + '\n'.join(shlex.join(c) for c in plan['commands']) + '\n', encoding='utf-8')
    print(plan['label'])
    print('Plan: scratch/deploy/plan.json; commands: scratch/deploy/commands.sh')
    if not args.execute:
        print('OFFLINE: no network, signature or transaction. Review prerequisites before authorized execution.')
        return
    print('Executing token, operation funding, game, then game token registration; stop on failure. Keys are retained.', flush=True)
    for command in plan['commands']:
        subprocess.run(command, check=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'rehearsal: {error}', file=sys.stderr)
        sys.exit(1)
