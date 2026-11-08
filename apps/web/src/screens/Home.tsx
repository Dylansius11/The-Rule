import { useState } from 'react';
import { useLatestRound, useLog } from '@/game';
import { SOLO, TEAM, type Mode } from '@/game/types';
import { Band } from '@/ui/Band';
import { ErrorCard } from '@/ui/ErrorCard';
import { Marquee } from '@/ui/Marquee';
import { StarField } from '@/ui/Doodle';
import { toUiError } from '@/chain/errors';
import { Art } from '@/art/Art';
import { Hero } from './home/Hero';
import { HowItWorks } from './home/HowItWorks';
import { MiniLog } from './home/MiniLog';
import { NoRoundOpen } from './home/NoRoundOpen';
import { PlayDesk } from './home/PlayDesk';
import { SealedStory } from './home/SealedStory';
import { isActive, isPlayable } from './shared/round';

const RIBBON = [
  "Don't think of the rule.",
  "You'll think of the rule.",
  'Stamps are final. Feelings are not.',
  'Testnet play money only',
  'Pick anything. The law stamps it.',
];

/** S1: hero, ribbon, stamp desk, ledger, sealed-law story, how it works. */
export function Home() {
  const solo = useLatestRound(SOLO);
  const team = useLatestRound(TEAM);
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode: Mode = picked ?? (isActive(solo.data) ? SOLO : isActive(team.data) ? TEAM : SOLO);
  const q = mode === SOLO ? solo : team;
  const round = q.data ?? null;
  const log = useLog(mode, round?.roundId ?? null, { follow: isActive(round) });

  return (
    <>
      <Hero mode={mode} onMode={setPicked} round={round} loading={q.isLoading} log={log} />
      <Marquee lines={RIBBON} hang />

      <Band
        tone="sun"
        id="play"
        label="Stamp desk"
        seed={2}
        amp={12}
        className="pb-24 pt-32 md:pb-28 md:pt-40"
      >
        <StarField
          spots={[
            { x: 3, y: 18, s: 50, r: -10, n: 'doodles/star-outline' },
            { x: 93, y: 12, s: 60, r: 14, n: 'doodles/star-outline' },
            { x: 48, y: 5, s: 34, r: 0, n: 'doodles/sparkle' },
            { x: 96, y: 66, s: 40, r: -14, n: 'doodles/star-outline' },
          ]}
        />
        {q.isError ? (
          <div className="wrap">
            <ErrorCard error={toUiError(q.error)} onRetry={() => void q.refetch()} />
          </div>
        ) : q.isLoading ? (
          <div className="wrap flex flex-col items-center text-center" aria-busy="true">
            <Art name="scenes/desk" width={200} eager />
            <p className="display text-[40px]">Asking the chain…</p>
          </div>
        ) : round && isPlayable(round) ? (
          <PlayDesk mode={mode} round={round} />
        ) : (
          <div className="wrap">
            <NoRoundOpen mode={mode} round={round} />
          </div>
        )}
      </Band>

      <Band tone="paper" id="ledger" label="Public ledger" seed={3} amp={10} className="pb-28 pt-28 md:pb-32">
        <MiniLog mode={mode} round={round} log={log} />
      </Band>

      <Band tone="ink" id="vault" label="The sealed law" seed={4} amp={16} className="pt-0">
        <SealedStory />
      </Band>

      <Band tone="bubblegum" id="how" label="How it works" seed={5} amp={12} className="pb-24 pt-28 md:pb-28">
        <HowItWorks />
      </Band>
    </>
  );
}
