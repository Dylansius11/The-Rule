import { useEffect, useRef, useState } from 'react';
import { formatNear } from '@/chain/format';
import { useSessionKey } from '@/chain/session/useSessionKey';
import {
  useCreditActions,
  useLockActions,
  useParams,
  usePlayer,
  useTokenState,
  useTokenStorage,
  useTokenStorageMinimum,
} from '@/game';
import { playCost } from '@/game/cost';
import { useConnect } from '@/layout/useConnect';
import { ActionSlip } from '@/ui/ActionSlip';
import { AmountField, readNear } from '@/ui/AmountField';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { isReadyToPlay, nextStep, setupSteps, type SetupStep, type StepId } from './setup';

const HIDDEN_KEY = 'the-rule:setup-hidden';
const busyKind = (s: { kind: string }) => s.kind === 'signing' || s.kind === 'pending';

const TITLE: Record<StepId, string> = {
  connect: 'Connect your wallet',
  key: 'Turn on the session key',
  credit: 'Add game credit',
  rule: 'Set up RULE',
};

/**
 * One place for everything a first play needs: wallet, session key, game credit and RULE registration. It reads
 * what the chain already has, shows exactly one next action, and goes away when nothing is left. The key and
 * RULE are optional once a play is affordable, so the card can be hidden for the session.
 */
export function SetupChecklist({ className = '' }: { className?: string }) {
  const { wallet, connect, busy: connecting } = useConnect();
  const account = wallet.accountId;
  const player = usePlayer(account);
  const params = useParams();
  const storage = useTokenStorage(account);
  const minimum = useTokenStorageMinimum();
  const token = useTokenState(account);
  const session = useSessionKey();
  const { deposit } = useCreditActions();
  const { storage: pay, register } = useLockActions(0, 0);
  const [amount, setAmount] = useState('1');
  const [hidden, setHidden] = useState(() => sessionStorage.getItem(HIDDEN_KEY) === '1');

  const cost = params.data ? playCost(params.data).total : null;
  const input = {
    connected: wallet.status === 'connected',
    session: session.status,
    storagePaid: storage.isSuccess ? !!storage.data : null,
    token: token.data ?? null,
    credit: player.isSuccess ? (player.data?.credit ?? 0n) : null,
    cost,
  };
  const steps = setupSteps(input);
  const next = nextStep(steps);
  const ready = isReadyToPlay(input);
  const keyActive = session.status === 'active' || session.status === 'low';

  // With a session key the game's registration check signs silently, so finish it as soon as storage is paid.
  const confirmed = useRef(false);
  useEffect(() => {
    if (confirmed.current || next?.id !== 'rule' || !input.storagePaid || !player.data) return;
    if (token.data !== 'none' || !keyActive || register.state.kind !== 'idle') return;
    confirmed.current = true;
    register.run();
  }, [next?.id, input.storagePaid, player.data, token.data, keyActive, register]);

  if (wallet.status !== 'connected') return null;
  const applicable = steps.filter(step => step.status !== 'unavailable');
  const done = applicable.filter(step => step.status === 'done').length;
  if (done === applicable.length) return null;
  if (ready && hidden) return null;

  const parsed = readNear(amount);
  const total = cost !== null ? formatNear(cost, 5) : null;

  function why(step: SetupStep): string {
    switch (step.id) {
      case 'connect':
        return 'A testnet wallet signs your deposit and your first approvals.';
      case 'key':
        return step.status === 'unavailable'
          ? 'This browser cannot hold a session key, so every action asks your wallet.'
          : 'One approval, then plays and guesses sign here with no popups. The key can spend your game credit and its gas allowance. It cannot withdraw NEAR or move RULE.';
      case 'credit':
        return `Plays and guess stakes are paid from game credit${total ? `; one play costs ${total} NEAR` : ''}. Unspent credit can be withdrawn.`;
      case 'rule':
        return minimum.data != null
          ? `Pay a one-time token storage fee of ${formatNear(minimum.data, 5)} NEAR so your account can hold RULE. Skip it and YES plays still count, but mint no RULE.`
          : 'Pay a one-time token storage fee so your account can hold RULE. Skip it and YES plays still count, but mint no RULE.';
    }
  }

  function action(step: SetupStep) {
    switch (step.id) {
      case 'connect':
        return (
          <Button variant="red" size="sm" onClick={connect} busy={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </Button>
        );
      case 'key':
        return (
          <Button variant="red" size="sm" busy={session.busy} onClick={() => void session.enable()}>
            Enable session key
          </Button>
        );
      case 'credit':
        return (
          <div className="grid max-w-[360px] gap-3">
            <AmountField
              label="Amount to deposit"
              value={amount}
              onChange={setAmount}
              error={parsed.error}
              disabled={busyKind(deposit.state)}
            />
            <div>
              <Button
                variant="red"
                size="sm"
                disabled={parsed.amount === null}
                busy={busyKind(deposit.state)}
                onClick={() => parsed.amount !== null && deposit.run(parsed.amount)}
              >
                Deposit {parsed.amount !== null ? `${amount.trim()} NEAR` : ''}
              </Button>
            </div>
          </div>
        );
      case 'rule':
        return input.storagePaid ? (
          <Button
            variant="red"
            size="sm"
            busy={busyKind(register.state)}
            disabled={!player.data}
            onClick={() => register.run()}
          >
            Confirm with the game
          </Button>
        ) : (
          <Button
            variant="red"
            size="sm"
            busy={busyKind(pay.state)}
            disabled={minimum.data == null}
            onClick={() => minimum.data != null && pay.run(minimum.data)}
          >
            Pay token storage{minimum.data != null ? ` · ${formatNear(minimum.data, 5)} NEAR` : ''}
          </Button>
        );
    }
  }

  return (
    <InkBox className={`p-5 md:p-6 ${className}`} fill="#fff" tilt={-0.3} aria-label="Get ready to play">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="display text-[clamp(30px,5vw,40px)] leading-none">
          {ready ? 'You can play. Two optional steps left.' : 'Get ready to play'}
        </h2>
        <span className="mono text-[13px] font-bold">
          {done} of {applicable.length} done
        </span>
      </div>
      <div
        className="meter mt-3"
        data-tone="lime"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={applicable.length}
        aria-valuenow={done}
      >
        <i style={{ width: `${(done / applicable.length) * 100}%` }} />
      </div>

      <ol className="mt-4 grid gap-4">
        {steps.map((step, index) => {
          if (step.status === 'unavailable' && step.id !== 'key') return null;
          const isNext = step.status === 'next';
          return (
            <li
              key={step.id}
              className={`flex gap-3 ${step.status === 'done' ? 'opacity-70' : ''}`}
              aria-current={isNext ? 'step' : undefined}
            >
              <span
                className="step-no shrink-0"
                aria-hidden="true"
                style={{
                  background:
                    step.status === 'done'
                      ? 'var(--color-lime)'
                      : isNext
                        ? 'var(--color-sun)'
                        : 'var(--color-paper)',
                }}
              >
                {step.status === 'done' ? '✓' : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 font-extrabold">
                  {TITLE[step.id]}
                  <span className="mono text-[12px] font-bold uppercase tracking-wide text-ink-soft">
                    {step.status === 'done'
                      ? 'done'
                      : step.status === 'unavailable'
                        ? 'not available'
                        : step.status === 'loading'
                          ? 'checking…'
                          : step.required
                            ? 'needed'
                            : 'recommended'}
                  </span>
                </p>
                {step.status !== 'done' ? (
                  <p className="mt-0.5 text-[15px] font-semibold">{why(step)}</p>
                ) : null}
                {isNext ? <div className="mt-3">{action(step)}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {session.notice ? (
        <p className="mt-4 text-[14px] font-bold" role="status">
          {session.notice}
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 empty:hidden">
        <ActionSlip
          state={deposit.state}
          onReset={deposit.reset}
          doneText="Deposit accepted. Your credit above updates when the chain shows it."
        />
        <ActionSlip
          state={pay.state}
          onReset={pay.reset}
          doneText="Storage payment accepted. RULE setup finishes when the token confirms it."
        />
        <ActionSlip
          state={register.state}
          onReset={register.reset}
          doneText="Registration check sent. Only the game's own status confirms it."
        />
      </div>

      {ready ? (
        <div className="mt-4 border-t-[3px] border-dashed border-ink/40 pt-3">
          <Button
            variant="paper"
            size="sm"
            onClick={() => {
              sessionStorage.setItem(HIDDEN_KEY, '1');
              setHidden(true);
            }}
          >
            Not now
          </Button>
        </div>
      ) : null}
    </InkBox>
  );
}
