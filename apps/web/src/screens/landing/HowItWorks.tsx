import { Art } from '@/art/Art';
import type { ArtName } from '@/art/manifest';
import { useGuide } from '@/layout/guide';
import { Button } from '@/ui/Button';
import { Doodle } from '@/ui/Doodle';
import { InkBox } from '@/ui/InkBox';

const STEPS: { art: ArtName; title: string; body: string; note: string; tilt: number }[] = [
  {
    art: 'scenes/arcade',
    title: 'Pick',
    body: 'Choose a number from 000 to 999 and a word from the published list. The rule is a short law over both, sealed before the first play.',
    note: 'any combo works',
    tilt: -1.5,
  },
  {
    art: 'scenes/desk',
    title: 'Stamp',
    body: 'Pay the small play fee. The sealed program answers YES or NO. A YES logs RULE for you. Repeating a play is free and shows the old answer.',
    note: 'the law decides',
    tilt: 1,
  },
  {
    art: 'scenes/envelope',
    title: 'Guess',
    body: 'Think you have it? Seal your guess as a hash, then open it later. The earliest correct guess wins 40% of the pot. A wrong one gets half its stake back.',
    note: 'commit, then reveal',
    tilt: -0.8,
  },
  {
    art: 'scenes/pool',
    title: 'Reveal',
    body: 'When the round ends the rule opens. Your browser replays every logged verdict against the rule and the commitment from day one.',
    note: 'check it yourself',
    tilt: 1.4,
  },
];

/** Four steps, each with its scene. */
export function HowItWorks() {
  const { show } = useGuide();
  return (
    <div className="wrap">
      <div className="relative mb-9 text-center">
        <h2 className="display text-[clamp(52px,8vw,104px)] leading-[0.85]">How it works</h2>
        <Doodle name="doodles/squiggle" size={200} className="mt-2" />
      </div>
      <ol className="grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <InkBox
              className="relative h-full p-5 pb-6"
              tilt={s.tilt}
              fill={i % 2 ? 'var(--color-paper)' : '#fff'}
            >
              <span className="step-no absolute -left-3 -top-4">{i + 1}</span>
              <div className="mx-auto mb-3 flex h-[180px] items-end justify-center">
                <Art name={s.art} width={s.art === 'scenes/pool' ? 190 : 170} />
              </div>
              <h3 className="display text-[40px] leading-none">{s.title}</h3>
              <p className="hand -rotate-1 text-[22px] leading-tight text-tomato-deep">{s.note}</p>
              <p className="mt-2 text-[17px] font-semibold leading-snug">{s.body}</p>
            </InkBox>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
        <Button to="/play" variant="red" size="lg">
          Enter the game
        </Button>
        <Button variant="paper" size="lg" onClick={show}>
          Open the guide
        </Button>
      </div>
    </div>
  );
}
