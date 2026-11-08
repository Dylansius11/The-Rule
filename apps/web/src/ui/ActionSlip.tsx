import { useEffect } from 'react';
import { useSound } from '@/audio';
import type { ActionState } from '@/game/types';
import { ErrorCard } from './ErrorCard';
import { HashText } from './HashText';
import { InkBox } from './InkBox';

interface ActionSlipProps {
  state: ActionState;
  /** What is true after the initiating transaction succeeded. Never claim async payments or mints completed. */
  doneText: string;
  onReset: () => void;
  signingText?: string;
}

/** Real signing / pending / done / error face for any wallet action. `done` means the transaction was accepted, not that a payment finished. */
export function ActionSlip({
  state,
  doneText,
  onReset,
  signingText = 'Your wallet is open. Nothing is charged until you approve.',
}: ActionSlipProps) {
  const { play } = useSound();
  const kind = state.kind;
  useEffect(() => {
    if (kind === 'done') play('success');
    if (kind === 'error') play('error');
  }, [kind, play]);
  if (state.kind === 'idle') return null;
  if (state.kind === 'error') return <ErrorCard error={state.error} onDismiss={onReset} />;
  return (
    <InkBox className="p-3" fill="#fff" radius="slip" aria-live="polite">
      {state.kind === 'signing' ? (
        <p className="flex items-center gap-3 font-bold">
          <span className="spinner" aria-hidden="true" />
          {signingText}
        </p>
      ) : null}
      {state.kind === 'pending' ? (
        <p className="flex items-center gap-3 font-bold">
          <span className="spinner" aria-hidden="true" />
          Sent. Waiting for the chain to confirm.
        </p>
      ) : null}
      {state.kind === 'done' ? (
        <div className="grid gap-1">
          <p className="font-extrabold">{doneText}</p>
          {state.txHash ? <HashText value={state.txHash} kind="tx" label="transaction hash" /> : null}
          <button
            type="button"
            className="min-h-[44px] w-fit text-left text-[14px] font-extrabold underline decoration-2"
            onClick={onReset}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </InkBox>
  );
}
