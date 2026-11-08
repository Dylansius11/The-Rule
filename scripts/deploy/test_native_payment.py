import base64
import copy
import json
import unittest
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import native_payment

from native_payment import classify

GAME = 'game.testnet'
OWNER = 'owner.testnet'
PLATFORM = 'platform.testnet'


def encoded(value):
    return base64.b64encode(json.dumps(value).encode()).decode()


def fixture(platform=False):
    method = 'claim_platform' if platform else 'withdraw_credit'
    recipient = PLATFORM if platform else OWNER
    request_id = 42
    def receipt(rid, predecessor, receiver, actions, inputs=(), outputs=()):
        return {'receipt_id': rid, 'predecessor_id': predecessor, 'receiver_id': receiver,
                'receipt': {'Action': {'actions': actions, 'input_data_ids': list(inputs),
                                       'output_data_receivers': list(outputs)}}}
    receipts = {
        'init': receipt('init', OWNER, GAME, [{'FunctionCall': {'method_name': method, 'args': encoded({} if platform else {'amount': '123'})}}]),
        'transfer': receipt('transfer', GAME, recipient, [{'Transfer': {'deposit': '123'}}], outputs=[{'data_id': 'promise-data', 'receiver_id': GAME}]),
        'callback': receipt('callback', GAME, GAME, [{'FunctionCall': {'method_name': 'on_platform' if platform else 'on_withdraw', 'args': encoded({'request_id': request_id}), 'gas': 10000000000000}}], inputs=['promise-data']),
    }
    def outcome(rid, status, children=()):
        return {'id': rid, 'block_hash': 'block', 'outcome': {'status': status, 'receipt_ids': list(children), 'gas_burnt': 1234}}
    tx = {'transaction_outcome': {'outcome': {'receipt_ids': ['init']}}, 'status': {'SuccessValue': ''},
          'receipts_outcome': [outcome('init', {'SuccessValue': encoded(request_id) if platform else ''}, ['transfer', 'callback']),
                               outcome('transfer', {'SuccessValue': ''}), outcome('callback', {'SuccessValue': ''})]}
    return tx, receipts


class PaymentClassification(unittest.TestCase):
    def test_initial_success_does_not_hide_callback_failure(self):
        tx, receipts = fixture()
        tx['receipts_outcome'][2]['outcome']['status'] = {'Failure': {'ActionError': 'out of gas'}}
        actual = classify(tx, receipts, GAME)
        self.assertEqual(actual['request_id'], 42)
        self.assertEqual(actual['transfer']['status'], 'success')
        self.assertEqual(actual['callback']['status'], 'failure')
        self.assertEqual(actual['callback']['raw_status'], {'Failure': {'ActionError': 'out of gas'}})
        self.assertEqual(actual['callback']['gas_allocated'], 10000000000000)

    def test_wrong_recipient_amount_and_unrelated_callback_are_unknown(self):
        tx, receipts = fixture()
        for mutation in ('recipient', 'amount', 'dependency', 'graph', 'request'):
            altered_tx, altered = copy.deepcopy(tx), copy.deepcopy(receipts)
            if mutation == 'recipient':
                altered['transfer']['receiver_id'] = 'other.testnet'
            elif mutation == 'amount':
                altered['transfer']['receipt']['Action']['actions'][0]['Transfer']['deposit'] = '124'
            elif mutation == 'dependency':
                altered['callback']['receipt']['Action']['input_data_ids'] = ['other-data']
            elif mutation == 'graph':
                altered_tx['receipts_outcome'][0]['outcome']['receipt_ids'].remove('callback')
            else:
                altered['callback']['receipt']['Action']['actions'][0]['FunctionCall']['args'] = encoded({'request_id': '42'})
            with self.subTest(mutation=mutation):
                actual = classify(altered_tx, altered, GAME)
                self.assertEqual(actual['transfer']['status'], 'unknown')
                self.assertEqual(actual['callback']['status'], 'unknown')

    def test_missing_receipt_or_outcome_is_unknown(self):
        tx, receipts = fixture()
        del receipts['callback']
        self.assertEqual(classify(tx, receipts, GAME)['callback']['status'], 'unknown')
        tx, receipts = fixture()
        tx['receipts_outcome'].pop()
        actual = classify(tx, receipts, GAME)
        self.assertEqual(actual['transfer']['status'], 'success')
        self.assertEqual(actual['callback']['status'], 'unknown')

    def test_transfer_failure_and_callback_success_are_separate(self):
        tx, receipts = fixture()
        tx['receipts_outcome'][1]['outcome']['status'] = {'Failure': {'ActionError': 'transfer failed'}}
        actual = classify(tx, receipts, GAME)
        self.assertEqual(actual['transfer']['status'], 'failure')
        self.assertEqual(actual['callback']['status'], 'success')
        self.assertIn('consistent', actual['diagnostic'])
        self.assertIn('verify code and state', actual['diagnostic'])

    def test_mismatched_executor_or_receipt_id_is_not_linked(self):
        for mutation in ('executor', 'receipt_id'):
            tx, receipts = fixture()
            if mutation == 'executor':
                tx['receipts_outcome'][2]['outcome']['executor_id'] = 'other.testnet'
            else:
                receipts['callback']['receipt_id'] = 'unrelated'
            with self.subTest(mutation=mutation):
                actual = classify(tx, receipts, GAME)
                self.assertEqual(actual['transfer']['status'], 'unknown')
                self.assertEqual(actual['callback']['status'], 'unknown')

    def test_malformed_graph_is_unknown(self):
        tx, receipts = fixture()
        tx['receipts_outcome'][0]['outcome']['receipt_ids'] = [{'unexpected': 'object'}]
        actual = classify(tx, receipts, GAME)
        self.assertEqual(actual['transfer']['status'], 'unknown')
        self.assertEqual(actual['callback']['status'], 'unknown')

    def test_cli_preserves_malformed_rpc_response_and_prints_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'scratch' / 'report.json'
            tx = {'transaction': {'hash': 'tx', 'signer_id': OWNER},
                  'transaction_outcome': {'outcome': {'receipt_ids': ['init']}},
                  'receipts_outcome': [{'outcome': {}}]}
            responses = [{'result': {'chain_id': 'testnet'}}, {'result': tx}]
            command = ['native_payment.py', '--rpc', 'https://rpc.testnet', '--game', GAME,
                       '--tx', 'tx', '--sender', OWNER, '--output', str(output)]
            stdout = StringIO()
            with patch.object(native_payment, 'ROOT', Path(directory)), \
                 patch.object(native_payment, 'rpc', side_effect=responses), \
                 patch('sys.argv', command), redirect_stdout(stdout):
                self.assertEqual(native_payment.main(), 1)
            report = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(report['transaction']['result'], tx)
            self.assertIn('Malformed or incomplete', report['error'])
            self.assertEqual(report['classification']['callback']['status'], 'unknown')
            self.assertIn('unknown', stdout.getvalue())

    def test_platform_recipient_and_returned_request_id(self):
        tx, receipts = fixture(platform=True)
        self.assertEqual(classify(tx, receipts, GAME, PLATFORM)['transfer']['status'], 'success')
        self.assertEqual(classify(tx, receipts, GAME)['transfer']['status'], 'unknown')
        self.assertEqual(classify(tx, receipts, GAME, OWNER)['transfer']['status'], 'unknown')
        tx['receipts_outcome'][0]['outcome']['status']['SuccessValue'] = encoded(43)
        self.assertEqual(classify(tx, receipts, GAME, PLATFORM)['callback']['status'], 'unknown')


if __name__ == '__main__':
    unittest.main()
