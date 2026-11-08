"""Offline artifact-boundary regressions; synthetic modules are never deployment evidence."""
import unittest
import copy
import hashlib
import json
import tempfile
from pathlib import Path

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
        log.write_text(f"Caller: {self.config['game_account']}\n{digest}  referee.wasm\n")
        self.config['referee_build_log'] = str(log)


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
