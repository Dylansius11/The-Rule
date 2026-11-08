import { Band } from '@/ui/Band';
import { StarField } from '@/ui/Doodle';
import { Marquee } from '@/ui/Marquee';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { LiveStrip } from './LiveStrip';
import { SealedStory } from './SealedStory';
import { SeasonTeaser } from './SeasonTeaser';

const RIBBON = [
  "Don't think of the rule.",
  "You'll think of the rule.",
  'Stamps are final. Feelings are not.',
  'Testnet play money only',
  'Pick anything. The law stamps it.',
];

/** The landing page: hero, ribbon, what is live, how it works, the sealed-law story, the season, then the footer. */
export function Landing() {
  return (
    <>
      <Hero />
      <Marquee lines={RIBBON} hang />

      <Band tone="sun" id="live" label="Live now" seed={2} amp={12} className="pb-24 pt-44 md:pb-28 md:pt-56">
        <StarField
          className="max-[1439px]:hidden"
          spots={[
            { x: 1.5, y: 40, s: 50, r: -10, n: 'doodles/star-outline' },
            { x: 96.5, y: 22, s: 56, r: 14, n: 'doodles/star-outline' },
            { x: 97, y: 70, s: 40, r: -14, n: 'doodles/sparkle' },
          ]}
        />
        <LiveStrip />
      </Band>

      <Band tone="bubblegum" id="how" label="How to play" seed={5} amp={12} className="pb-24 pt-28 md:pb-28">
        <HowItWorks />
      </Band>

      <Band tone="ink" id="vault" label="The sealed law" seed={4} amp={16} className="pt-0">
        <SealedStory />
      </Band>

      <Band tone="grape" id="season" label="Season" seed={3} amp={12} className="pb-24 pt-28 md:pb-28">
        <SeasonTeaser />
      </Band>
    </>
  );
}
