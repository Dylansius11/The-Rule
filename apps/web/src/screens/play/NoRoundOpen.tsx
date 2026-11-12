import { Link } from 'react-router';
import { roomPath } from '@/app/paths';
import { toUiError } from '@/chain/errors';
import { Art } from '@/art/Art';
import { useLatestRevealedRound, useNextSlot } from '@/game';
import type { Mode, Round } from '@/game/types';
import { Blot } from '@/mascot/Blot';
import { useNow } from '@/motion/hooks';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { ErrorCard } from '@/ui/ErrorCard';
import { fmtIn, fmtUtc } from '@/screens/shared/format';
import { modeName, phaseLabel, outcomeLabel } from '@/screens/shared/round';
import { RoundTimer } from '@/screens/shared/RoundTimer';

/**
 * The honest face of the desk when plays are closed. Says what is true (phase, next slot, last revealed round)
 * and offers the places that still work. Never fakes a round.
 */
export function NoRoundOpen({ mode, round }: { mode: Mode; round: Round | null }) {
  const slot = useNextSlot(mode);
  const revealed = useLatestRevealedRound();
  const now = useNow(30_000);
  const closing = round && (round.phase === 'Investigation' || ['Reveal', 'Opening'].includes(round.phase));
  const preparing = round && ['Scheduled', 'Sealing'].includes(round.phase);

  const title = preparing ? 'The law is being sealed.' : closing ? 'Plays are closed.' : 'No round is open.';
  const body = preparing
    ? 'Plays open once the sealed program has committed to its rule. Nothing to sign yet.'
    : closing
      ? 'The round is closing. The rule opens at the reveal.'
      : round
        ? `${modeName(mode)} round ${round.roundId} is ${phaseLabel(round.phase).toLowerCase()}${round.outcome ? ` (${outcomeLabel(round).toLowerCase()})` : ''}. Nothing is being stamped right now.`
        : `No ${modeName(mode).toLowerCase()} round has started on this deployment yet.`;

  const scheduled = !!slot.data && slot.data.slotMs > Date.UTC(2020, 0, 1);
  const next =
    slot.data && scheduled
      ? slot.data.slotMs > now
        ? `Next ${modeName(mode).toLowerCase()} slot: round ${slot.data.roundId}, ${fmtUtc(slot.data.slotMs)} (${fmtIn(slot.data.slotMs, now)}).`
        : `The next slot (round ${slot.data.roundId}) has been due since ${fmtUtc(slot.data.slotMs)}. It opens once someone starts it; the contract lets anyone do that.`
      : slot.isLoading
        ? 'Checking the schedule…'
        : slot.isError
          ? 'Could not read the schedule right now.'
          : 'No next slot is scheduled on this deployment.';

  return (
    <InkBox className="relative mx-auto max-w-[760px] p-6 text-center md:p-10" tilt={-0.8}>
      <div className="mx-auto mb-3 w-[min(240px,60vw)]">
        {preparing ? <Blot state="pending" width="100%" /> : <Art name="stickers/asleep" width={220} eager />}
      </div>
      <h2 className="display text-[clamp(40px,7vw,64px)] leading-[0.9]" aria-live="polite">
        {title}
      </h2>
      <p className="mx-auto mt-3 max-w-[48ch] text-[19px] font-bold leading-snug">{body}</p>
      {round && closing ? (
        <RoundTimer round={round} className="mx-auto mt-4 max-w-[420px] text-left" />
      ) : null}
      <p className="mono mx-auto mt-3 max-w-[56ch] text-[14px] font-bold">{next}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        {revealed.data ? (
          <Button to={roomPath(revealed.data.mode, 'verify', revealed.data.roundId)} variant="red">
            See an opened law
          </Button>
        ) : null}
        {round ? (
          <Button to={roomPath(mode, 'ledger', round.roundId)} variant="paper">
            Read the ledger
          </Button>
        ) : null}
      </div>
      {revealed.data ? (
        <p className="mt-4 text-[15px] font-semibold">
          Opened law found: {modeName(revealed.data.mode)} round {revealed.data.roundId},{' '}
          {revealed.data.logLen} plays,{' '}
          <Link
            to={roomPath(revealed.data.mode, 'verify', revealed.data.roundId)}
            className="font-extrabold underline decoration-2 underline-offset-2"
          >
            replay every verdict in your browser
          </Link>
          .
        </p>
      ) : null}
      {revealed.isError ? (
        <div className="mt-4">
          <ErrorCard error={toUiError(revealed.error)} onRetry={revealed.refetch} />
        </div>
      ) : null}
    </InkBox>
  );
}
