#!/usr/bin/env python3
"""Read-only testnet RPC observations; this does not authenticate or recover payments."""
import argparse
import base64
import json
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def rpc(url, method, params):
    body = json.dumps({'jsonrpc': '2.0', 'id': 'native-payment', 'method': method, 'params': params}).encode()
    try:
        with urlopen(Request(url, data=body, headers={'Content-Type': 'application/json'}), timeout=30) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        return {'transport_error': str(exc)}


def result(response):
    return response.get('result') if isinstance(response, dict) else None


def action(receipt):
    try:
        body = receipt['receipt']['Action']
        actions = body['actions']
        return body, actions[0] if len(actions) == 1 else {}
    except (KeyError, TypeError):
        return {}, {}


def args(call):
    try:
        value = json.loads(base64.b64decode(call['args'], validate=True))
        return value if isinstance(value, dict) else {}
    except (KeyError, ValueError, TypeError):
        return {}


def outcome_status(entry):
    status = (entry or {}).get('outcome', {}).get('status', {})
    if isinstance(status, dict):
        if 'Failure' in status:
            return 'failure'
        if 'SuccessValue' in status or 'SuccessReceiptId' in status:
            return 'success'
    return 'unknown'


def classify(tx, receipts, game, platform=None):
    """Return unknown rather than trusting malformed or partial RPC data."""
    try:
        return classify_graph(tx, receipts, game, platform)
    except (AttributeError, KeyError, TypeError, ValueError):
        return {'transfer': {'status': 'unknown'}, 'callback': {'status': 'unknown'},
                'diagnostic': 'Malformed or incomplete RPC receipt graph.'}


def classify_graph(tx, receipts, game, platform=None):
    """Classify only a unique, linked transfer and its promise-dependent callback."""
    report = {'transfer': {'status': 'unknown'}, 'callback': {'status': 'unknown'},
              'diagnostic': 'No uniquely bound payment found.'}
    if not isinstance(tx, dict):
        return report
    entries = {entry['id']: entry for entry in tx.get('receipts_outcome', []) if isinstance(entry, dict) and 'id' in entry}
    root = tx.get('transaction_outcome', {})
    reachable, todo = set(), list(root.get('outcome', {}).get('receipt_ids', []))
    while todo:
        rid = todo.pop()
        if rid in reachable:
            continue
        reachable.add(rid)
        todo.extend(entries.get(rid, {}).get('outcome', {}).get('receipt_ids', []))
    initiators = []
    for rid in reachable:
        receipt = receipts.get(rid) or {}
        _, act = action(receipt)
        call = act.get('FunctionCall', {})
        if receipt.get('receipt_id') == rid and receipt.get('receiver_id') == game and call.get('method_name') in ('withdraw_credit', 'claim_platform'):
            initiators.append((rid, receipt, call))
    if len(initiators) != 1:
        report['diagnostic'] = 'Missing or ambiguous initiating payment receipt.'
        return report
    rid, initiating, call = initiators[0]
    method = call['method_name']
    report.update({'initiating_receipt_id': rid, 'method': method,
                   'initiating_predecessor': initiating.get('predecessor_id'),
                   'initiating_status': outcome_status(entries.get(rid))})
    if outcome_status(entries.get(rid)) != 'success':
        report['diagnostic'] = 'Initiating receipt is not observed successful.'
        return report
    expected = initiating.get('predecessor_id') if method == 'withdraw_credit' else platform
    amount = args(call).get('amount') if method == 'withdraw_credit' else None
    if not isinstance(expected, str) or (method == 'withdraw_credit' and (not isinstance(amount, str) or not re.fullmatch(r'0|[1-9][0-9]*', amount))):
        report['diagnostic'] = 'Expected recipient or withdrawal amount unavailable.'
        return report
    children = entries[rid].get('outcome', {}).get('receipt_ids', [])
    transfers, callbacks = [], []
    callback_method = 'on_withdraw' if method == 'withdraw_credit' else 'on_platform'
    for child in children:
        receipt = receipts.get(child) or {}
        if receipt.get('receipt_id') != child or receipt.get('predecessor_id') != game:
            continue
        body, act = action(receipt)
        transfer = act.get('Transfer')
        if isinstance(transfer, dict) and receipt.get('receiver_id') == expected:
            deposit = transfer.get('deposit')
            if isinstance(deposit, str) and re.fullmatch(r'0|[1-9][0-9]*', deposit) and (amount is None or deposit == amount):
                transfers.append((child, body, deposit))
        callback = act.get('FunctionCall', {})
        if receipt.get('receiver_id') == game and callback.get('method_name') == callback_method:
            request_id = args(callback).get('request_id')
            if type(request_id) is int and 0 <= request_id < 2**64:
                callbacks.append((child, body, callback, request_id))
    pairs = []
    for tid, transfer, deposit in transfers:
        outputs = {(x.get('data_id'), x.get('receiver_id')) for x in transfer.get('output_data_receivers', []) if isinstance(x, dict)}
        for cid, cb, call_data, request_id in callbacks:
            inputs = cb.get('input_data_ids', [])
            if len(inputs) == 1 and (inputs[0], game) in outputs:
                pairs.append((tid, cid, deposit, call_data, request_id))
    if method == 'claim_platform':
        try:
            returned = json.loads(base64.b64decode(entries[rid]['outcome']['status']['SuccessValue'], validate=True))
        except (KeyError, ValueError, TypeError):
            returned = None
        pairs = [pair for pair in pairs if type(returned) is int and pair[4] == returned]
    if len(pairs) != 1:
        report['diagnostic'] = 'Missing, mismatched, or ambiguous transfer/callback dependency.'
        return report
    tid, cid, deposit, cb_call, request_id = pairs[0]
    for payment_id, executor in ((rid, game), (tid, expected), (cid, game)):
        outcome = entries.get(payment_id, {}).get('outcome', {})
        if 'executor_id' in outcome and outcome['executor_id'] != executor:
            report['diagnostic'] = 'Receipt outcome executor does not match the linked receipt.'
            return report
    def details(receipt_id):
        entry = entries.get(receipt_id, {})
        outcome = entry.get('outcome', {})
        return {'receipt_id': receipt_id, 'status': outcome_status(entry),
                'raw_status': outcome.get('status'), 'gas_burnt': outcome.get('gas_burnt'),
                'block_hash': entry.get('block_hash')}
    report.update({'request_id': request_id, 'expected_recipient': expected,
                   'amount_yoctonear': deposit, 'transfer': details(tid), 'callback': details(cid),
                   'diagnostic': 'RPC-observed linked payment; not an authenticated on-chain proof or recovery.'})
    report['callback']['gas_allocated'] = cb_call.get('gas')
    if report['transfer']['status'] == 'failure' and report['callback']['status'] == 'success':
        report['diagnostic'] += ' Callback success is consistent with the deployed failure-restoration branch; verify code and state separately.'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('rpc', 'game', 'tx', 'sender', 'output'):
        parser.add_argument('--' + option, required=True)
    opt = parser.parse_args()
    output = Path(opt.output).resolve()
    scratch = (ROOT / 'scratch').resolve()
    if not output.is_relative_to(scratch) or output == scratch:
        parser.error('--output must be a file under scratch/')
    observations = {'notice': 'Public RPC observations, not on-chain authentication; no recovery or transaction is performed.',
                    'rpc': opt.rpc, 'game': opt.game, 'tx': opt.tx, 'sender': opt.sender}
    observations['classification'] = {'transfer': {'status': 'unknown'}, 'callback': {'status': 'unknown'},
                                      'diagnostic': 'RPC observation incomplete.'}
    try:
        observations['status'] = rpc(opt.rpc, 'status', [])
        if (result(observations['status']) or {}).get('chain_id') != 'testnet':
            observations['error'] = 'RPC did not confirm testnet; transaction was not queried.'
        else:
            observations['transaction'] = rpc(opt.rpc, 'tx', {'tx_hash': opt.tx, 'sender_account_id': opt.sender, 'wait_until': 'INCLUDED_FINAL'})
            tx = result(observations['transaction']) or {}
            if tx and (tx.get('transaction', {}).get('hash') != opt.tx or tx.get('transaction', {}).get('signer_id') != opt.sender):
                observations['error'] = 'RPC transaction hash or signer did not match the request.'
                tx = {}
            ids = set(tx.get('transaction_outcome', {}).get('outcome', {}).get('receipt_ids', []))
            for entry in tx.get('receipts_outcome', []):
                ids.add(entry['id'])
                ids.update(entry.get('outcome', {}).get('receipt_ids', []))
            observations['receipts'] = {}
            for rid in sorted(ids):
                observations['receipts'][rid] = rpc(opt.rpc, 'EXPERIMENTAL_receipt', {'receipt_id': rid})
            receipts = {rid: result(value) for rid, value in observations['receipts'].items()}
            preliminary = classify(tx, receipts, opt.game)
            initiator = preliminary.get('initiating_receipt_id')
            block = next((x.get('block_hash') for x in tx.get('receipts_outcome', []) if x.get('id') == initiator), None)
            platform = None
            if block and preliminary.get('method') == 'claim_platform':
                observations['params'] = rpc(opt.rpc, 'query', {'request_type': 'call_function', 'block_id': block, 'account_id': opt.game, 'method_name': 'get_params', 'args_base64': 'e30='})
                try:
                    params = json.loads(bytes(result(observations['params'])['result']))
                    platform = params['platform'] if params.get('chain_id') == 'testnet' else None
                except (AttributeError, KeyError, TypeError, ValueError):
                    pass
            observations['classification'] = classify(tx, receipts, opt.game, platform)
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        observations['error'] = f'Malformed or incomplete RPC response: {exc}'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(observations, indent=2) + '\n', encoding='utf-8')
    print(f'RPC observation saved to {output}')
    print(json.dumps(observations['classification'], indent=2))
    if 'error' in observations:
        print(observations['error'], file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
