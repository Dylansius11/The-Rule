import { motion } from 'motion/react';
import { useReduced } from '@/motion/prefs';

const COLORS = [
  'var(--color-tomato)',
  'var(--color-sun)',
  'var(--color-grape)',
  'var(--color-lime)',
  'var(--color-bubblegum)',
];
const PIECES = 42;

/** Deterministic 0..1 value from an index and a salt, so a render never changes its own layout. */
const unit = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Paper confetti falling through the nearest positioned parent (give it `overflow-hidden`). Plays once per `fire`
 * value and is absent under reduced motion. Purely decorative.
 */
export function Confetti({ fire }: { fire: string | number | null }) {
  const reduced = useReduced();
  if (fire === null || reduced) return null;
  return (
    <span className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, i) => {
        const left = unit(i, 1) * 100;
        const size = 8 + unit(i, 2) * 10;
        const drift = (unit(i, 3) - 0.5) * 160;
        const delay = unit(i, 4) * 0.7;
        const duration = 1.8 + unit(i, 5) * 1.4;
        const turn = (unit(i, 6) - 0.5) * 900;
        return (
          <motion.span
            key={`${fire}-${i}`}
            className="absolute top-0 block border-2 border-ink"
            style={{
              left: `${left}%`,
              width: size,
              height: size * (i % 3 === 0 ? 1 : 0.55),
              borderRadius: i % 4 === 0 ? '50%' : 2,
              background: COLORS[i % COLORS.length],
            }}
            initial={{ y: -40, x: 0, rotate: 0, opacity: 1 }}
            animate={{ y: 420, x: drift, rotate: turn, opacity: [1, 1, 0] }}
            transition={{ duration, delay, ease: [0.25, 0.6, 0.4, 1], times: [0, 0.75, 1] }}
          />
        );
      })}
    </span>
  );
}
