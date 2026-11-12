"""Offline regressions for the ceremony script; the fake chain mirrors real RPC payload shapes."""
import base64
import contextlib
import copy
import hashlib
import io
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import ceremony

sys.path.insert(0, str(ceremony.ROOT / 'scripts/deploy'))
import test_rehearsal as fx  # noqa: E402  (only its helper functions are used)

GAME, TOKEN = 'game.therule.testnet', 'token.therule.testnet'
EMPTY_CODE = '11111111111111111111111111111111'
KEY_A, KEY_B = 'ed25519:' + 'A' * 44, 'ed25519:' + 'B' * 44


class FakeChain:
    """Serves the JSON-RPC methods the ceremony uses, from a small state dict."""

    def __init__(self, params, game_code=b'game', token_code=b'token'):
        self.keys = {GAME: [KEY_A], TOKEN: [KEY_A, KEY_B]}
        self.code = {GAME: game_code, TOKEN: token_code}
        # Live get_params also returns fields init does not carry (observed on demo-game.therule.testnet).
        self.params = {**params, 'demo': False, 'user_referee_request_limit': 1, 'max_pending_referee_requests': 8}
        self.registered = True
        self.timestamp_ns = 1
        self.missing = set()

    def post(self, url, payload):
        params = payload['params']
        if payload['method'] == 'block':
            return {'result': {'header': {'hash': 'H', 'height': 7, 'timestamp_nanosec': str(self.timestamp_ns)}}}
        if payload['method'] == 'status':
            return {'result': {'chain_id': 'testnet'}}
        kind, account = params['request_type'], params['account_id']
        if account in self.missing:
            return {'error': {'name': 'HANDLER_ERROR', 'cause': {'name': 'UNKNOWN_ACCOUNT'}}}
        if kind == 'view_access_key_list':
            keys = [{'public_key': k, 'access_key': {'nonce': 1, 'permission': 'FullAccess'}} for k in self.keys[account]]
            return {'result': {'block_hash': 'H', 'block_height': 7, 'keys': keys}}
        if kind == 'view_account':
            return {'result': {'block_hash': 'H', 'block_height': 7, 'amount': '10' * 12, 'code_hash': 'X' * 44}}
        if kind == 'view_code':
            return {'result': {'block_hash': 'H', 'block_height': 7, 'code_base64': base64.b64encode(self.code[account]).decode()}}
        if kind == 'call_function':
            value = self.params if params['method_name'] == 'get_params' else ({'total': '1'} if self.registered else None)
            return {'result': {'block_hash': 'H', 'block_height': 7, 'result': list(json.dumps(value).encode())}}
        raise AssertionError(payload)


class CeremonyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ceremony.ROOT / 'scratch')
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        config = json.loads((ceremony.ROOT / 'scripts/deploy/example.json').read_text())
        bound = (ceremony.ROOT / 'enclave/referee/manifest.json').read_text().strip().replace('<GAME_ACCOUNT_PLACEHOLDER>', GAME).encode()
        referee = fx.MODULE + fx.manifest(bound)
        for name in ('game', 'token', 'referee'):
            path = root / (name + '.wasm')
            path.write_bytes(referee if name == 'referee' else fx.MODULE + name.encode())
            config[name + '_wasm'] = str(path)
        digest = hashlib.sha256(referee).hexdigest()
        config.update(deployment_kind='production', demo=False, game_account=GAME, token_account=TOKEN, referee_sha256=digest)
        config['params'].update(token=TOKEN, genesis_ns=time.time_ns() + 4 * 3_600_000_000_000, investigation_max_ns=82_800_000_000_000,
                                reveal_window_ns=600_000_000_000, begin_timeout_ns=600_000_000_000, open_timeout_ns=600_000_000_000)
        config['params']['referee']['hash'] = digest
        log = root / 'build.log'
        log.write_text(f'Caller: {GAME}\nFeature: production\n{digest}  referee.wasm\n')
        config['referee_build_log'] = str(log)
        self.deploy = config
        self.plan = ceremony.build_plan(config, time.time_ns())

    def chain(self):
        # The fixture artifacts are tiny byte strings that match the planned hashes. The chain holds its own
        # copy of the params so a test can make the chain differ from the plan.
        chain = FakeChain(copy.deepcopy(self.plan['expected_params']), b'\0asm\x01\0\0\0game', b'\0asm\x01\0\0\0token')
        return chain, ceremony.Rpc(['https://a.example'], chain.post)

    def test_plan_refuses_a_first_slot_without_margin_and_non_production_inputs(self):
        for change in ({'genesis_ns': time.time_ns() + 7_300_000_000_000}, ):
            bad = copy.deepcopy(self.deploy)
            bad['params'].update(change)
            with self.assertRaisesRegex(ValueError, 'still 2 h away'):
                ceremony.build_plan(bad, time.time_ns())
        for change in ({'demo': True}, {'game_account': 'game-r2.therule.testnet'}, {'deployment_kind': 'rehearsal'}):
            bad = copy.deepcopy(self.deploy)
            bad.update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                ceremony.build_plan(bad, time.time_ns())

    def test_load_accepts_inline_production_deploy_config(self):
        path = Path(self.tmp.name) / 'inline.json'
        path.write_text(json.dumps({'deploy_config': self.deploy, 'rpc_urls': ['https://a.example'],
                                    'min_balance_yocto': {'game': '1', 'token': '1', 'payer': '1'}}))
        _, deploy = ceremony.load(path)
        self.assertEqual(deploy, self.deploy)

    def test_deletion_is_one_atomic_transaction_per_account_covering_every_key(self):
        commands = ceremony.deletion_commands({GAME: [KEY_A], TOKEN: [KEY_A, KEY_B], 'empty.testnet': []})
        self.assertEqual(len(commands), 2)
        self.assertEqual(commands[1][3:6], [TOKEN, 'public-keys', f'{KEY_A},{KEY_B}'])
        self.assertTrue(all(c[-1] == 'send' for c in commands))

    def test_verify_fails_while_a_single_key_remains_and_passes_when_empty(self):
        chain, rpc = self.chain()
        chain.keys[GAME] = []
        record, failures = ceremony.verify(rpc, self.plan)
        self.assertEqual(failures, [f'{TOKEN}: 2 access key(s) remain'])
        chain.keys[TOKEN] = []
        record, failures = ceremony.verify(rpc, self.plan)
        self.assertEqual(failures, [])
        self.assertEqual(record['accounts'][GAME]['keys'], [])

    def test_verify_catches_wrong_code_params_registration_and_a_passed_slot(self):
        for name, mutate in (
            ('code', lambda c: c.code.update({GAME: b'other'})),
            ('params', lambda c: c.params.update(play_fee='1')),
            ('demo contract', lambda c: c.params.update(demo=True)),
            ('registration', lambda c: setattr(c, 'registered', False)),
            ('slot passed', lambda c: setattr(c, 'timestamp_ns', c.params['genesis_ns'])),
        ):
            chain, rpc = self.chain()
            chain.keys = {GAME: [], TOKEN: []}
            mutate(chain)
            with self.subTest(name):
                _, failures = ceremony.verify(rpc, self.plan)
                self.assertTrue(failures, name)

    def test_rpc_fails_over_and_reads_unknown_account_as_absent(self):
        chain, _ = self.chain()
        calls = []

        def post(url, payload):
            calls.append(url)
            if url == 'https://down.example':
                raise OSError('rate limited')
            return chain.post(url, payload)

        rpc = ceremony.Rpc(['https://down.example', 'https://up.example'], post)
        self.assertEqual(ceremony.access_keys(rpc, GAME)['keys'], [KEY_A])
        self.assertEqual(calls[:2], ['https://down.example', 'https://up.example'])
        chain.missing.add(GAME)
        self.assertIsNone(ceremony.account_state(rpc, GAME))
        with self.assertRaises(ceremony.RpcError):
            ceremony.Rpc(['https://down.example'], post).call('status', [])

    def test_key_deletion_refuses_without_the_exact_phrase_and_sends_nothing(self):
        (Path(self.tmp.name) / 'ceremony.json').write_text(json.dumps({
            'deploy_config': str(Path(self.tmp.name) / 'deploy.json'), 'rpc_urls': ['https://a.example'],
            'min_balance_yocto': {'game': '1', 'token': '1', 'payer': '1'}}))
        (Path(self.tmp.name) / 'deploy.json').write_text(json.dumps(self.deploy))
        chain, _ = self.chain()
        with mock.patch.object(ceremony, 'OUT', Path(self.tmp.name)), \
                mock.patch.object(ceremony.Rpc, '_post', staticmethod(chain.post)), \
                mock.patch.object(ceremony.subprocess, 'run') as run, \
                contextlib.redirect_stdout(io.StringIO()):
            (Path(self.tmp.name) / 'plan.json').write_text(json.dumps(self.plan))
            argv = [str(Path(self.tmp.name) / 'ceremony.json'), 'execute', '--step', 'delete-keys']
            self.assertEqual(ceremony.main(argv), 0)  # dry run
            with self.assertRaisesRegex(ValueError, 'refusing'):
                ceremony.main(argv + ['--execute', '--confirm', 'delete-keys'])
            run.assert_not_called()

    def test_key_deletion_refuses_when_the_chain_does_not_match_the_plan(self):
        (Path(self.tmp.name) / 'ceremony.json').write_text(json.dumps({
            'deploy_config': str(Path(self.tmp.name) / 'deploy.json'), 'rpc_urls': ['https://a.example'],
            'min_balance_yocto': {'game': '1', 'token': '1', 'payer': '1'}}))
        (Path(self.tmp.name) / 'deploy.json').write_text(json.dumps(self.deploy))
        chain, _ = self.chain()
        chain.params['play_fee'] = '1'
        with mock.patch.object(ceremony, 'OUT', Path(self.tmp.name)), \
                mock.patch.object(ceremony.Rpc, '_post', staticmethod(chain.post)), \
                mock.patch.object(ceremony.subprocess, 'run') as run, \
                contextlib.redirect_stdout(io.StringIO()):
            (Path(self.tmp.name) / 'plan.json').write_text(json.dumps(self.plan))
            phrase = f'delete-keys {GAME} {TOKEN}'
            with self.assertRaisesRegex(ValueError, 'keys kept'):
                ceremony.main([str(Path(self.tmp.name) / 'ceremony.json'), 'execute', '--step', 'delete-keys', '--execute', '--confirm', phrase])
            run.assert_not_called()

    def test_reject_late_key_deletion_before_scheduling(self):
        chain, _ = self.chain()
        chain.timestamp_ns = self.plan['expected_params']['genesis_ns'] + 1
        with mock.patch.object(ceremony, 'load', return_value=({'rpc_urls': ['https://a.example']}, self.deploy)), \
                mock.patch.object(ceremony, 'saved_plan', return_value=self.plan), \
                mock.patch.object(ceremony.Rpc, '_post', staticmethod(chain.post)), \
                mock.patch.object(ceremony, 'write_evidence'), \
                mock.patch.object(ceremony, 'run_commands') as dispatch, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, 'keys kept'):
                ceremony.main(['unused.json', 'execute', '--step', 'delete-keys', '--execute',
                               '--confirm', f'delete-keys {GAME} {TOKEN}'])
            dispatch.assert_not_called()

    def test_reject_empty_keys_from_unbound_later_block(self):
        chain, _ = self.chain()
        chain.keys = {GAME: [], TOKEN: []}
        chain.timestamp_ns = self.plan['expected_params']['genesis_ns'] - 1

        def post(url, payload):
            response = chain.post(url, payload)
            if payload['method'] == 'query' and payload['params']['request_type'] == 'view_access_key_list':
                response['result'].update(block_hash='LATER', block_height=8)
            return response

        _, failures = ceremony.verify(ceremony.Rpc(['https://a.example'], post), self.plan)
        self.assertTrue(failures, 'empty keys from another block cannot establish pre-genesis keylessness')

    def test_same_block_pre_genesis_control(self):
        chain, _ = self.chain()
        chain.keys = {GAME: [], TOKEN: []}
        chain.timestamp_ns = self.plan['expected_params']['genesis_ns'] - 1
        queries = []

        def post(url, payload):
            if payload['method'] == 'query':
                queries.append(payload['params'])
            return chain.post(url, payload)

        record, failures = ceremony.verify(ceremony.Rpc(['https://a.example'], post), self.plan)
        self.assertEqual(failures, [])
        self.assertEqual(record['block'], {'hash': 'H', 'height': 7, 'timestamp_ns': chain.timestamp_ns})
        self.assertTrue(queries)
        self.assertTrue(all(q.get('block_id') == 'H' and 'finality' not in q for q in queries))

    def test_deletion_headroom_boundary_and_second_account_recheck(self):
        chain, rpc = self.chain()
        deadline = self.plan['expected_params']['genesis_ns'] - 600_000_000_000
        chain.timestamp_ns = deadline - 1
        ceremony.require_deletion_window(rpc, self.plan, 600)
        chain.timestamp_ns = deadline
        with self.assertRaisesRegex(ValueError, 'keys kept'):
            ceremony.require_deletion_window(rpc, self.plan, 600)
        chain.timestamp_ns = deadline - 1
        commands = ceremony.deletion_commands(chain.keys)

        def first_transaction(*args, **kwargs):
            chain.timestamp_ns = deadline
            return mock.Mock(returncode=0, stdout='', stderr='')

        with mock.patch.object(ceremony, 'write_evidence'), \
                mock.patch.object(ceremony.subprocess, 'run', side_effect=first_transaction) as dispatch, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, 'keys kept'):
                ceremony.run_commands(commands, 'delete_key_txs',
                                      before_each=lambda: ceremony.require_deletion_window(rpc, self.plan, 600))
            self.assertEqual(dispatch.call_count, 1)

    def test_verify_rejects_every_unbound_deployment_response(self):
        for kind in ('view_account', 'view_code', 'call_function'):
            with self.subTest(kind=kind):
                chain, _ = self.chain()
                chain.keys = {GAME: [], TOKEN: []}

                def post(url, payload):
                    response = chain.post(url, payload)
                    if payload['method'] == 'query' and payload['params']['request_type'] == kind:
                        response['result'].update(block_hash='LATER', block_height=8)
                    return response

                _, failures = ceremony.verify(ceremony.Rpc(['https://a.example'], post), self.plan)
                self.assertTrue(any('BLOCK_MISMATCH' in f for f in failures))

    def test_commands_stop_at_the_first_failure_and_record_each_transaction(self):
        tx = 'a' * 44
        results = [mock.Mock(returncode=0, stdout=f'Transaction ID: {tx}', stderr=''), mock.Mock(returncode=1, stdout='', stderr='boom')]
        with mock.patch.object(ceremony, 'OUT', Path(self.tmp.name)), \
                mock.patch.object(ceremony.subprocess, 'run', side_effect=results) as run, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'boom'):
                ceremony.run_commands([['one'], ['two'], ['three']], 'deploy_txs')
        self.assertEqual(run.call_count, 2)
        recorded = json.loads((Path(self.tmp.name) / 'evidence.json').read_text())['deploy_txs']
        self.assertEqual([r['tx'] for r in recorded], [tx, None])


if __name__ == '__main__':
    unittest.main()
