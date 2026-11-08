import { useSound } from '@/audio';

export interface GuessStep {
  title: string;
  note: string;
}

interface StepNavProps {
  steps: readonly GuessStep[];
  /** Zero-based index of the open step. */
  current: number;
  /** Steps the player may jump to. */
  reachable: (index: number) => boolean;
  onGo: (index: number) => void;
}

/** The four numbered stops across the top of the guess card. Jumping back is always allowed; forward only when the step's input exists. */
export function StepNav({ steps, current, reachable, onGo }: StepNavProps) {
  const { play } = useSound();
  return (
    <ol className="grid grid-cols-4 gap-2 md:gap-4" aria-label="Guess steps">
      {steps.map((s, i) => (
        <li key={s.title}>
          <button
            type="button"
            disabled={!reachable(i)}
            aria-current={i === current ? 'step' : undefined}
            aria-label={`Step ${i + 1}: ${s.title}`}
            className="step-stop"
            onClick={() => {
              play('tap');
              onGo(i);
            }}
          >
            <span className="step-no" aria-hidden="true">
              {i + 1}
            </span>
            <span className="display text-[22px] leading-none max-md:hidden" aria-hidden="true">
              {s.title}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
