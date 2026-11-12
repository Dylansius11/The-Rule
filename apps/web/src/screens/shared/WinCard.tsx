import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { roomPath } from '@/app/paths';
import { formatNear } from '@/chain/format';
import { useClaimable, useWallet } from '@/game';
import { Blot } from '@/mascot/Blot';
import { Confetti } from '@/mascot/Confetti';
import { useReduced } from '@/motion/prefs';
import { useRuleText } from '@/verify';
import { Button } from '@/ui/Button';
import { StatSticker } from '@/ui/Sticker';
import { ClaimAll } from './ClaimAll';
import { modeName } from './round';
import type { WinEvent } from './winEvents';

/** The celebration card: Blot, the reward, the opened rule when there is one, and the next action. */
export default function WinCard({ event, onClose }: { event: WinEvent; onClose: () => void }) {
  const reduced = useReduced();
  const heading = useRef<HTMLHeadingElement>(null);
  // The card mounts after the dialog opened (it is its own chunk), so the dialog's autofocus has missed it.
  useEffect(() => heading.current?.focus(), []);
  const { accountId } = useWallet();
  const { mode, round } = event;
  const owed = useClaimable(mode, round.roundId, event.kind === 'won' ? accountId : null).data ?? 0n;
  const text = useRuleText(round.rule);
  const won = event.kind === 'won';
  const kicker = won ? `${modeName(mode).toLowerCase()} round ${round.roundId}` : 'your guess';
  const title = won ? (event.team ? 'Your team cracked it.' : 'You cracked it.') : 'Judged correct.';

  return (
    <div className="relative overflow-hidden p-6 text-center md:p-8">
      <Confetti fire={event.id} />
      <button
        type="button"
        className="absolute right-3 top-3 z-30 grid min-h-[44px] min-w-[44px] place-items-center rounded-full border-[3px] border-ink bg-sun font-display text-[22px] font-black"
        onClick={onClose}
        aria-label="Close"
      >
        ✕
      </button>
      <div className="relative z-20">
        <motion.span
          className="hand block -rotate-2 text-[26px] leading-none"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          {kicker}
        </motion.span>
        <motion.h2
          ref={heading}
          id="win-title"
          tabIndex={-1}
          className="display mt-1 text-[clamp(44px,11vw,72px)] leading-[0.85] outline-none"
          initial={reduced ? false : { scale: 2.6, rotate: -8, opacity: 0 }}
          animate={{ scale: 1, rotate: -2, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 16, mass: 0.9 }}
        >
          {title}
        </motion.h2>
        <div className="mx-auto mt-2 w-[min(190px,50vw)]">
          <Blot state="yes" width="100%" pulse={event.id} burst={event.id} />
        </div>

        <p className="mx-auto mt-3 max-w-[44ch] text-[17px] font-bold leading-snug">
          {won
            ? `${event.team ? "Your team's" : 'Your'} commit was the earliest correct one. Verify replays every verdict against the opened rule in your browser.`
            : round.phase === 'Settled'
              ? 'The sealed program recorded your guess as Correct. The round has settled: Verify shows who the earliest correct commit was.'
              : 'The sealed program recorded your guess as Correct. The earliest correct commit wins the pot, and nothing is paid until the round settles.'}
        </p>

        <dl className="mt-4 flex flex-wrap items-start justify-center gap-x-3.5 gap-y-4" aria-label="Reward">
          {won && owed > 0n ? (
            <StatSticker label="ready to claim" tone="lime" tilt={-2} mono>
              {formatNear(owed, 4)} NEAR
            </StatSticker>
          ) : null}
          <StatSticker label={won ? 'final pot' : 'pot so far'} tone="sun" tilt={1.5} mono>
            {formatNear(round.pot, 3)} NEAR
          </StatSticker>
          {event.kind === 'correct' ? (
            <StatSticker label="your stake" tone="paper" tilt={-1} mono>
              {formatNear(event.commit.stake, 3)} NEAR
            </StatSticker>
          ) : null}
        </dl>

        <p className="mt-4 rounded-2xl border-[3px] border-ink bg-paper-2 px-3 py-2 text-left text-[15px] font-bold">
          {text ? (
            <>
              <span className="hand block text-[22px] leading-none">the law, opened</span>
              {text.english}
            </>
          ) : (
            'The rule opens at the reveal. Verify shows it once it has.'
          )}
        </p>

        {won ? <ClaimAll className="mt-4 text-left" /> : null}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Button to={roomPath(mode, 'verify', round.roundId)} variant="grape" onClick={onClose}>
            Verify the round
          </Button>
          <Button variant="paper" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
