import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Art } from '@/art/Art';
import { useReduced } from '@/motion/prefs';
import { useSigningCopy } from '@/chain/session/useSessionKey';
import type { PlayState } from '@/game/types';
import { Amount } from './Amount';
import { ErrorCard } from './ErrorCard';
import { HashText } from './HashText';
import { InkBox } from './InkBox';
import { LiveRegion } from './LiveRegion';
import { StampMark } from './StampMark';

const pad = (n: number) => String(n).padStart(3, '0');

/** Plain words for screen readers; what the slip says visually, without stamps. */
export function slipAnnouncement(
  state: PlayState,
  signing = 'Waiting for your wallet. Nothing is charged until you approve.',
): string {
  switch (state.kind) {
    case 'idle':
      return '';
    case 'prechecking':
      return 'Checking the public log for this exact play.';
    case 'signing':
      return signing;
    case 'pending':
      return 'Waiting for the sealed program. Your fee is safe.';
    case 'known':
      return `Already tried: ${state.row.verdict ? 'YES' : 'NO'}. ${pad(state.input.number)} ${state.input.word}. Nothing was charged.`;
    case 'accepted':
      return `Accepted. ${pad(state.input.number)} ${state.input.word} got YES.`;
    case 'rejected':
      return `Rejected. ${pad(state.input.number)} ${state.input.word} got NO. The fee joined the pot.`;
    case 'refunded':
      return 'Refunded. The sealed program could not answer. Your fee came back.';
    case 'error':
      return `${state.error.title} ${state.error.funds} ${state.error.next}`;
  }
}

function Waiting({
  title,
  note,
  children,
  art,
}: {
  title: string;
  note: string;
  children?: ReactNode;
  art?: boolean;
}) {
  return (
    <div className="flex items-center gap-3.5 text-left">
      {art ? <Art name="stickers/stamping" width={64} className="shrink-0" /> : null}
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div>
        <div className="font-hand text-[24px] leading-[1.05]">{title}</div>
        <div className="mt-1 text-[15px] font-bold">{note}</div>
        {children}
      </div>
    </div>
  );
}

/**
 * The slip the stamp lands on. Every PlayState has a face. A pending request never looks like a verdict,
 * and every state that touches money says whether funds moved.
 */
export function PlaySlip({
  state,
  onDismissError,
  onRetry,
}: {
  state: PlayState;
  onDismissError?: () => void;
  onRetry?: () => void;
}) {
  const reduced = useReduced();
  const copy = useSigningCopy();
  let body: ReactNode;

  switch (state.kind) {
    case 'idle':
      body = <p className="font-hand text-[22px] text-ink-soft">your stamped slip lands here</p>;
      break;
    case 'prechecking':
      body = <Waiting title="Checking the log…" note="Looking for this exact play. Free, nothing to sign." />;
      break;
    case 'signing':
      body = <Waiting title={copy.title} note={copy.note} />;
      break;
    case 'pending':
      body = (
        <Waiting art title="Waiting for the sealed program." note="Your fee is safe. Waiting is fine.">
          {state.txHash ? (
            <div className="mt-1.5">
              <HashText value={state.txHash} kind="tx" label="transaction hash" />
            </div>
          ) : null}
        </Waiting>
      );
      break;
    case 'known':
      body = (
        <div className="flex flex-col items-center text-center">
          <Art name="stickers/lift" width={64} />
          <b className="display block text-[34px] leading-none">
            Already tried: {state.row.verdict ? 'YES' : 'NO'}
          </b>
          <span className="mono text-[14px] font-bold">
            {pad(state.input.number)} {state.input.word} · nothing charged · no log row
          </span>
        </div>
      );
      break;
    case 'accepted':
      body = (
        <div className="relative flex flex-col items-center gap-2 text-center">
          <StampMark tone="yes" slam={!reduced} size={44}>
            Accepted!
          </StampMark>
          <motion.span
            className="absolute -right-5 -top-9 z-10"
            initial={reduced ? false : { scale: 2.2, rotate: 18, opacity: 0 }}
            animate={{ scale: 1, rotate: 8, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.25 }}
          >
            <Art name="stickers/star" width={84} />
          </motion.span>
          <div>
            <b className="display block text-[30px] leading-none">
              {pad(state.input.number)} · {state.input.word}
            </b>
            <span className="mono text-[14px] font-bold">
              YES, logged <Amount kind="rule" value={state.row.minted} rise className="!text-[14px]" /> for
              you
            </span>
          </div>
          {state.txHash ? <HashText value={state.txHash} kind="tx" label="transaction hash" /> : null}
        </div>
      );
      break;
    case 'rejected':
      body = (
        <div className="flex flex-col items-center gap-2 text-center">
          <StampMark tone="no" slam={reduced ? false : 'small'} size={44}>
            Rejected.
          </StampMark>
          <div>
            <b className="display block text-[30px] leading-none">
              {pad(state.input.number)} · {state.input.word}
            </b>
            <span className="mono text-[14px] font-bold">NO · the fee joined the pot</span>
          </div>
          {state.txHash ? <HashText value={state.txHash} kind="tx" label="transaction hash" /> : null}
        </div>
      );
      break;
    case 'refunded':
      body = (
        <div className="text-center">
          <StampMark tone="soft" slam={false} size={38}>
            Refunded
          </StampMark>
          <p className="mt-2 font-extrabold">The sealed program could not answer. Your fee came back.</p>
          <p className="text-[15px]">
            No verdict was recorded for {pad(state.input.number)} {state.input.word}.
          </p>
          {state.txHash ? <HashText value={state.txHash} kind="tx" label="transaction hash" /> : null}
        </div>
      );
      break;
    case 'error':
      body = (
        <ErrorCard error={state.error} onRetry={onRetry} onDismiss={onDismissError} className="w-full" />
      );
      break;
  }

  return (
    <InkBox
      className="slip mx-auto mt-6 grid min-h-[132px] w-full max-w-[380px] place-items-center px-3.5 py-3.5"
      radius="slip"
    >
      <div className="w-full">{body}</div>
      <LiveRegion
        message={slipAnnouncement(state, `${copy.title} ${copy.note}`)}
        assertive={state.kind === 'error'}
      />
    </InkBox>
  );
}
