import { useState } from 'react';
import { formatRule } from '@/chain/format';
import { useLockActions, useTokenOperation, useTokenOutcome, useWallet } from '@/game';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { Tag } from '@/ui/Tag';

const OUTCOME_TEXT: Record<string, string> = {
  applied: 'Applied: the token operation completed.',
  receiver_unregistered:
    'Rejected: the receiving account was not registered with the token. Register it, then ask for a retry only if the operation is still pending.',
  insufficient_balance: 'Rejected: the balance was too low.',
  cap_exceeded: 'Rejected: it would have gone over the token cap.',
  invalid_amount: 'Rejected: the amount was not valid.',
};

const parseId = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * Manual recovery by known id. The contract has no account-wide list, so this page can only look up an id you already have.
 * A retry is offered only while the contract itself reports that operation as pending.
 */
export function TokenRecovery() {
  const { accountId } = useWallet();
  const [reqText, setReqText] = useState('');
  const [opText, setOpText] = useState('');
  const reqId = parseId(reqText);
  const opId = parseId(opText);
  const pending = useTokenOperation(reqId);
  const outcome = useTokenOutcome(opId);
  const { retry } = useLockActions(0, 0);
  const mine = pending.data && pending.data.accountId === accountId;

  return (
    <InkBox className="p-5 md:p-6" fill="#fff" tilt={-0.4}>
      <h3 className="display text-[34px] leading-none">Token operations</h3>
      <p className="mt-2 text-[16px] font-semibold">
        Mints and unlocks settle in a second step. The contract offers no list of them, so look one up by the
        id from its receipt. Nothing here guesses.
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="req-id" className="mb-1 block font-extrabold">
            Pending request id
          </label>
          <input
            id="req-id"
            className="field field-mono"
            inputMode="numeric"
            value={reqText}
            onChange={e => setReqText(e.target.value)}
            placeholder="e.g. 12"
            aria-invalid={reqText !== '' && reqId === null ? true : undefined}
          />
          <div className="mt-2" aria-live="polite">
            {reqText !== '' && reqId === null ? (
              <p className="font-extrabold text-tomato-deep">Use digits only.</p>
            ) : null}
            {reqId !== null && pending.isLoading ? (
              <p className="font-bold" aria-busy="true">
                Asking the contract…
              </p>
            ) : null}
            {reqId !== null && pending.isSuccess && pending.data === null ? (
              <p className="font-bold">
                Not pending now. It either finished or never existed; look up its outcome by operation id.
              </p>
            ) : null}
            {pending.data ? (
              <div className="grid gap-2 font-bold">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="sun">Pending</Tag>
                  <span className="mono text-[14px]">
                    {pending.data.kind} · {formatRule(pending.data.amount)} RULE · operation{' '}
                    {pending.data.operationId}
                  </span>
                </div>
                <span className="mono break-all text-[13px]">account {pending.data.accountId}</span>
                {mine ? (
                  <Button
                    variant="red"
                    size="sm"
                    busy={retry.state.kind === 'signing' || retry.state.kind === 'pending'}
                    onClick={() => reqId !== null && retry.run(reqId)}
                  >
                    Retry this operation
                  </Button>
                ) : (
                  <p className="text-[14px]">
                    This operation belongs to another account, so recovery is not offered here.
                  </p>
                )}
                <ActionSlip
                  state={retry.state}
                  onReset={retry.reset}
                  doneText="Retry sent. Look the operation up again in a moment to see whether it is still pending."
                />
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <label htmlFor="op-id" className="mb-1 block font-extrabold">
            Operation id (outcome)
          </label>
          <input
            id="op-id"
            className="field field-mono"
            inputMode="numeric"
            value={opText}
            onChange={e => setOpText(e.target.value)}
            placeholder="e.g. 12"
            aria-invalid={opText !== '' && opId === null ? true : undefined}
          />
          <div className="mt-2" aria-live="polite">
            {opText !== '' && opId === null ? (
              <p className="font-extrabold text-tomato-deep">Use digits only.</p>
            ) : null}
            {opId !== null && outcome.isLoading ? (
              <p className="font-bold" aria-busy="true">
                Asking the token…
              </p>
            ) : null}
            {opId !== null && outcome.isSuccess && outcome.data === null ? (
              <p className="font-bold">
                The token holds no outcome for this id. That is not proof of failure: it may still be pending
                or unknown.
              </p>
            ) : null}
            {outcome.data ? (
              <div className="grid gap-1 font-bold">
                <Tag tone={outcome.data.status === 'applied' ? 'yes' : 'no'}>
                  {outcome.data.status === 'applied' ? '✓ applied' : '✗ rejected'}
                </Tag>
                <p>{OUTCOME_TEXT[outcome.data.status] ?? outcome.data.status}</p>
                <span className="mono text-[13px]">
                  {outcome.data.operation.kind} · {formatRule(outcome.data.operation.amount)} RULE ·{' '}
                  {outcome.data.operation.accountId}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </InkBox>
  );
}
