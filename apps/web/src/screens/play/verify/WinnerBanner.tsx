import { motion } from 'motion/react';
import { formatNear } from '@/chain/format';
import { useClaimable } from '@/game';
import type { Mode, Round } from '@/game/types';
import { Blot } from '@/mascot/Blot';
import { Confetti } from '@/mascot/Confetti';
import { useReduced } from '@/motion/prefs';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { StatSticker } from '@/ui/Sticker';
import { modeName } from '@/screens/shared/round';

interface WinnerBannerProps {
  mode: Mode;
  round: Round;
  /** The connected account, if any. */
  account: string | null;
  /** The browser replay passed: the verdicts match the revealed rule and the commitment. */
  verified: boolean;
  /** Verdicts replayed, for the closing sticker. */
  matched: number;
  total: number;
}

/**
 * The payoff of a solved round. It appears only after the browser's own replay has passed, so the celebration is
 * attached to a verified result, never to the chain's word alone. The winner is the earliest correct commit; the
 * banner says so and never promises a price or a return for RULE.
 */
export function WinnerBanner({ mode, round, account, verified, matched, total }: WinnerBannerProps) {
  const reduced = useReduced();
  const outcome = round.outcome;
  const mine = outcome?.kind === 'Solved' && account !== null && outcome.account === account;
  const claimable = useClaimable(mode, round.roundId, mine ? account : null);
  if (outcome?.kind !== 'Solved' || !verified) return null;

  const team = outcome.entityTag === 1;
  const who = team ? `Team #${outcome.entityId}` : outcome.account;
  const owed = claimable.data ?? 0n;

  return (
    <InkBox
      className="relative overflow-hidden p-6 text-ink md:p-9"
      fill="var(--color-sun)"
      tilt={0.8}
      aria-label={mine ? 'You solved this round' : 'This round was solved'}
    >
      <Confetti fire={mine ? `won-${round.roundId}` : null} />
      <div className="relative z-20 grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <motion.span
            className="hand block -rotate-2 text-[26px] leading-none"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            {mine ? 'that was you' : `${modeName(mode).toLowerCase()} round ${round.roundId}`}
          </motion.span>
          <motion.h2
            className="display mt-1 text-[clamp(48px,9vw,96px)] leading-[0.85]"
            initial={reduced ? false : { scale: 2.6, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: -2, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 16, mass: 0.9 }}
          >
            {mine ? 'You cracked it.' : 'Solved.'}
          </motion.h2>
          <p className="mt-3 max-w-[54ch] text-[18px] font-bold leading-snug">
            {mine
              ? 'Your commit was the earliest correct one, and your browser just replayed every verdict against the opened rule.'
              : 'The earliest correct commit wins, and your browser just replayed every verdict against the opened rule.'}
          </p>
          <p className="mono mt-2 break-all text-[14px] font-bold">
            winner {who}
            {team ? ` · committed by ${outcome.account}` : ''}
          </p>
          {mine && owed > 0n ? (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <p className="font-extrabold">{formatNear(owed, 4)} NEAR is ready for you to claim.</p>
              <Button to="/account" variant="red" size="sm">
                Claim on your account
              </Button>
            </div>
          ) : null}
          <dl className="mt-5 flex flex-wrap gap-x-3.5 gap-y-4" aria-label="Round result">
            <StatSticker label="final pot" tone="paper" tilt={-2}>
              {formatNear(round.pot, 3)} NEAR
            </StatSticker>
            <StatSticker label="plays" tone="pink" tilt={1.5}>
              {round.logLen.toLocaleString('en-US')}
            </StatSticker>
            <StatSticker label="replayed" tone="lime" tilt={-1}>
              {matched} of {total}
            </StatSticker>
          </dl>
        </div>
        <div className="relative mx-auto w-[min(190px,46vw)] md:w-[220px]">
          <Blot state="yes" width="100%" pulse={`win-${round.roundId}`} burst={`win-${round.roundId}`} />
        </div>
      </div>
    </InkBox>
  );
}
