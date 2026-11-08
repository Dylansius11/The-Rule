import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useSound } from '@/audio';
import { Art } from '@/art/Art';
import type { ArtName } from '@/art/manifest';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Doodle } from '@/ui/Doodle';
import { useGuide } from './guide';

interface Step {
  art: ArtName;
  artWidth: number;
  title: string;
  note: string;
  body: string;
  doodle:
    'doodles/star-yellow' | 'doodles/sparkle' | 'doodles/magnifier' | 'doodles/envelope' | 'doodles/jar';
}

const STEPS: readonly Step[] = [
  {
    art: 'scenes/arcade',
    artWidth: 250,
    title: 'Pick a number and a word',
    note: 'any combo works',
    body: 'Every play is a number from 000 to 999 and one word from a short published list. Spin the reels, tap a word chip. There is no wrong thing to try.',
    doodle: 'doodles/star-yellow',
  },
  {
    art: 'scenes/desk',
    artWidth: 220,
    title: 'The sealed law stamps it',
    note: 'YES or NO, nothing else',
    body: 'A hidden law, committed before the first play, answers YES or NO. A YES mints RULE for you. Most of every play fee (80%) goes into the pot. Testnet play money only.',
    doodle: 'doodles/sparkle',
  },
  {
    art: 'heron/vest',
    artWidth: 150,
    title: 'Read the ledger, spot the pattern',
    note: 'every row is public',
    body: 'Each play lands in a public ledger with its number, word and verdict. Filter it, search it, and look for what the YES rows have in common. Repeating a play is free.',
    doodle: 'doodles/magnifier',
  },
  {
    art: 'scenes/envelope',
    artWidth: 230,
    title: 'Commit a guess with a stake',
    note: 'seal it, then open it',
    body: 'Write your guess as one or two published atoms, test it free against the ledger, then seal it with a stake. The earliest correct commit wins 40% of the pot.',
    doodle: 'doodles/envelope',
  },
  {
    art: 'scenes/pool',
    artWidth: 240,
    title: 'The rule opens. You replay it.',
    note: 'check it yourself',
    body: 'When the round ends the rule is revealed. Your own browser replays every logged verdict against it and against the commitment from day one. Then the pot pays out: 40% to the winner, 40% shared by every unique play.',
    doodle: 'doodles/jar',
  },
];

const SWIPE = 70;

/** The five-step illustrated guide. Opens on a first visit to /play, from the ? button and from settings. */
export function HowToPlay() {
  const { open, hide } = useGuide();
  return (
    <Dialog open={open} onClose={hide} labelledBy="guide-title" className="guide">
      <Steps onDone={hide} />
    </Dialog>
  );
}

function Steps({ onDone }: { onDone: () => void }) {
  const { play } = useSound();
  const [[index, dir], setPage] = useState<[number, number]>([0, 1]);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  function go(next: number) {
    if (next < 0 || next >= STEPS.length || next === index) return;
    play('page');
    setPage([next, next > index ? 1 : -1]);
  }

  return (
    <div
      className="relative"
      onKeyDown={e => {
        if (e.key === 'ArrowRight') go(index + 1);
        if (e.key === 'ArrowLeft') go(index - 1);
      }}
    >
      <button
        type="button"
        onClick={onDone}
        className="absolute right-3 top-3 z-10 grid min-h-[44px] min-w-[44px] place-items-center rounded-full border-[3px] border-ink bg-paper font-display text-[22px] font-black leading-none"
        aria-label="Close the guide"
      >
        ✕
      </button>

      <div className="guide-stage relative overflow-hidden">
        <p className="mono absolute left-4 top-4 z-10 text-[13px] font-bold uppercase tracking-widest">
          How to play · {index + 1} of {STEPS.length}
        </p>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={index}
            custom={dir}
            initial={{ x: dir * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -60, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={(_, info) => {
              if (info.offset.x < -SWIPE) go(index + 1);
              else if (info.offset.x > SWIPE) go(index - 1);
            }}
            className="flex h-full items-end justify-center pb-4 pt-10"
          >
            <Art name={step.art} width={step.artWidth} eager className="relative z-[1]" />
            <Doodle name={step.doodle} size={54} x={14} y={30} rot={-12} twinkle className="max-sm:hidden" />
            <Doodle name="doodles/sparkle" size={40} x={82} y={24} rot={14} twinkle delay={0.6} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="px-5 pb-5 pt-4 md:px-9 md:pb-7" aria-live="polite">
        <span className="hand -rotate-1 block text-[24px] leading-none text-tomato-deep">{step.note}</span>
        <h2 id="guide-title" className="display mt-1 text-[clamp(34px,6.5vw,52px)] leading-[0.92]">
          {step.title}
        </h2>
        <p className="mt-3 min-h-[5.5em] max-w-[52ch] text-[17px] font-semibold leading-snug md:min-h-[4.2em] md:text-[18px]">
          {step.body}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t-[3px] border-dashed border-ink/40 px-4 py-4 md:gap-3 md:px-9">
        <Button variant="paper" size="sm" disabled={index === 0} onClick={() => go(index - 1)} sound={false}>
          Back
        </Button>
        <ol className="flex items-center" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                className="guide-dot"
                aria-label={`Step ${i + 1}: ${s.title}`}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => go(i)}
              />
            </li>
          ))}
        </ol>
        <Button
          variant="red"
          size="sm"
          onClick={() => (last ? onDone() : go(index + 1))}
          sound={false}
          data-autofocus
        >
          {last ? "Let's play" : 'Next'}
        </Button>
      </div>
    </div>
  );
}
