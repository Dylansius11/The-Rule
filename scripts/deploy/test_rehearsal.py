"""Offline artifact-boundary regressions; synthetic modules are never deployment evidence."""
import unittest
import copy
import hashlib
import json
import tempfile
from pathlib import Path
import time

from rehearsal import ROOT, prepare, referee_manifest

MODULE = b'\0asm\x01\0\0\0'
COMPONENT = b'\0asm\x0d\0\x01\0'
MANIFEST = b'{"caller":"game-r1.therule.testnet"}'


def leb(value):
    out = bytearray()
    while value >= 128:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return bytes(out)


def section(kind, payload):
    return bytes([kind]) + leb(len(payload)) + payload


def custom(name, payload):
    return section(0, leb(len(name)) + name + payload)


def manifest(payload=MANIFEST):
    return custom(b'outlayer.manifest', payload)


class RefereeManifestTests(unittest.TestCase):
    def test_nested_section_is_distinguished_from_program_data_copies(self):
        module = MODULE + custom(b'program-data', MANIFEST) + manifest(MANIFEST + b'\n')
        artifact = COMPONENT + section(4, COMPONENT + section(1, module))
        self.assertEqual(referee_manifest(artifact), MANIFEST)

    def test_expected_text_elsewhere_cannot_hide_the_wrong_bound_section(self):
        wrong = b'{"caller":"other.testnet"}'
        artifact = MODULE + custom(b'program-data', MANIFEST) + manifest(wrong)
        self.assertEqual(referee_manifest(artifact), wrong)
        self.assertNotEqual(referee_manifest(artifact), MANIFEST)

    def test_absent_or_ambiguous_manifest_is_rejected(self):
        for artifact in (
            MODULE + custom(b'program-data', MANIFEST),
            MODULE + manifest() + manifest(),
            COMPONENT + manifest() + section(1, MODULE + manifest()),
        ):
            with self.subTest(artifact=artifact), self.assertRaisesRegex(ValueError, 'exactly one'):
                referee_manifest(artifact)

    def test_malformed_boundaries_and_excessive_nesting_are_rejected(self):
        deep = MODULE + manifest()
        for _ in range(34):
            deep = COMPONENT + section(4 if deep.startswith(COMPONENT) else 1, deep)
        for artifact in (
            b'\0asm',
            MODULE + b'\0\x80',
            MODULE + b'\0\xff\xff\xff\xff\x10',
            MODULE + b'\0\x04a',
            MODULE + section(0, b'\x7fshort'),
            COMPONENT + section(1, b'not-a-module'),
            deep,
        ):
            with self.subTest(artifact=artifact[:24]), self.assertRaises(ValueError):
                referee_manifest(artifact)


class OperationFundingPlanTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'scratch').mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / 'scratch')
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.config = json.loads((ROOT / 'scripts/deploy/example.json').read_text())
        bound = (ROOT / 'enclave/referee/manifest.json').read_text().strip().replace(
            '<GAME_ACCOUNT_PLACEHOLDER>', self.config['game_account']).encode()
        referee = MODULE + manifest(bound)
        for name in ('game', 'token', 'referee'):
            path = root / (name + '.wasm')
            path.write_bytes(referee if name == 'referee' else MODULE + b'fixture')
            self.config[name + '_wasm'] = str(path)
        digest = hashlib.sha256(referee).hexdigest()
        self.config['referee_sha256'] = self.config['params']['referee']['hash'] = digest
        log = root / 'build.log'
        log.write_text(f"Caller: {self.config['game_account']}\nFeature: production\n{digest}  referee.wasm\n")
        self.config['referee_build_log'] = str(log)

    def bind_referee(self, kind):
        config = self.config
        bound = (ROOT / 'enclave/referee/manifest.json').read_text().strip().replace(
            '<GAME_ACCOUNT_PLACEHOLDER>', config['game_account']).encode()
        referee = MODULE + manifest(bound) + (custom(b'data', b'RULE_DEMO') if kind == 'demo' else b'')
        Path(config['referee_wasm']).write_bytes(referee)
        digest = hashlib.sha256(referee).hexdigest()
        config['referee_sha256'] = config['params']['referee']['hash'] = digest
        Path(config['referee_build_log']).write_text(
            f"Snapshot: fixture\nCaller: {config['game_account']}\nFeature: {kind}\n{digest}  referee.wasm\n")

    def as_demo(self):
        self.config['deployment_kind'] = 'demo'
        self.config['game_account'] = 'demo-game-r1.therule.testnet'
        self.config['token_account'] = self.config['params']['token'] = 'demo-token-r1.therule.testnet'
        self.config['params']['referee']['demo_secrets_ref'] = {'profile': 'demo', 'account_id': 'therule.testnet'}
        self.bind_referee('demo')

    def test_kinds_bind_accounts_artifacts_and_labels(self):
        self.bind_referee('production')
        self.assertIn('non-demo referee', prepare(self.config)['label'])
        self.as_demo()
        plan = prepare(self.config)
        self.assertEqual(plan['label'], 'Demo Mode - preselected rule')
        self.assertNotIn('RULE_DEMO', json.dumps(plan))
        self.assertEqual(plan['game_init']['params']['referee']['demo_secrets_ref'], {'profile': 'demo', 'account_id': 'therule.testnet'})
        for change in (
            {'deployment_kind': 'rehearsal'},
            {'demo': False},
            {'token_account': 'demo-token-r2.therule.testnet'},
            {'game_account': 'game-r1.therule.testnet'},
        ):
            config = copy.deepcopy(self.config)
            config.update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                prepare(config)
        for kind in (None, 'production'):
            config = copy.deepcopy(self.config)
            if kind is None:
                del config['deployment_kind']
            else:
                config['deployment_kind'] = kind
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                prepare(config)
        self.bind_referee('production')
        with self.assertRaises(ValueError):
            prepare(self.config)
        self.bind_referee('demo')
        Path(self.config['referee_build_log']).write_text(
            Path(self.config['referee_build_log']).read_text().replace('Feature: demo', 'Feature: production'))
        with self.assertRaises(ValueError):
            prepare(self.config)

    def test_secret_reference_kind_and_shape(self):
        config = copy.deepcopy(self.config)
        config['params']['referee']['demo_secrets_ref'] = {'profile': 'demo', 'account_id': 'therule.testnet'}
        with self.assertRaises(ValueError):
            prepare(config)
        self.as_demo()
        for ref in (None, {}, {'profile': '', 'account_id': 'therule.testnet'},
                    {'profile': 'bad space', 'account_id': 'therule.testnet'},
                    {'profile': 'a' * 65, 'account_id': 'therule.testnet'},
                    {'profile': 'demo', 'account_id': 'example.near'},
                    {'profile': 'demo', 'account_id': 'therule.testnet', 'value': 'secret'}):
            config = copy.deepcopy(self.config)
            config['params']['referee']['demo_secrets_ref'] = ref
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                prepare(config)

    def test_rehearsal_rejects_demo_artifact_and_wrong_caller(self):
        self.bind_referee('demo')
        with self.assertRaises(ValueError):
            prepare(self.config)
        self.bind_referee('production')
        log = Path(self.config['referee_build_log'])
        log.write_text(log.read_text().replace(self.config['game_account'], 'game-r1.therule.testnet'))
        with self.assertRaises(ValueError):
            prepare(self.config)

    def test_schedule_bounds(self):
        for key, value in [('investigation_max_ns', 0), ('mode_offset_ns', [0, self.config['params']['round_period_ns']])]:
            config = copy.deepcopy(self.config)
            config['params'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                prepare(config)
        config = copy.deepcopy(self.config)
        config['demo'] = False
        p = config['params']
        p['genesis_ns'] = time.time_ns() + 20_000_000_000_000
        p['reveal_window_ns'] = 600_000_000_000
        prepare(config)
        for changes in (
            {'investigation_max_ns': p['round_period_ns']},
            {'round_period_ns': 2**64 - 1, 'investigation_max_ns': 86_400_000_000_000},
            {'genesis_ns': 2**64 - 1},
        ):
            bad = copy.deepcopy(config)
            bad['params'].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                prepare(bad)

    def test_missing_or_invalid_funding_is_rejected(self):
        for key, value in [('token_operation_funding', '0'),
                           ('token_operation_funding', '01'),
                           ('operation_funding_payer', 'mainnet'),
                           ('operation_funding_gas', 0),
                           ('operation_funding_gas', 300_000_000_000_001)]:
            config = copy.deepcopy(self.config)
            config[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                prepare(config)
        config = copy.deepcopy(self.config)
        del config['token_operation_funding']
        with self.assertRaises(ValueError):
            prepare(config)


if __name__ == '__main__':
    unittest.main()
