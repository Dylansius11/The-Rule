import { useReduced } from '@/motion/prefs';

/** A hand-drawn splat: one lumpy centre and a ring of drops. Fixed shapes, no randomness. */
const DROPS: [number, number, number][] = [
  [28, 52, 11],
  [44, 22, 8],
  [96, 10, 10],
  [158, 26, 9],
  [186, 78, 12],
  [176, 150, 9],
  [120, 190, 11],
  [52, 170, 8],
  [14, 112, 7],
];
const BLOB =
  'M100 34c18-6 34 4 44 14 15-2 30 8 32 24 12 10 12 28 2 40 2 18-12 34-30 34-10 14-30 18-44 10-14 10-36 8-46-4-18 4-34-8-36-24-14-10-14-30-2-42-4-16 8-32 24-34 8-12 28-18 56-18z';

/**
 * Ink thrown across the stamp card when a verdict lands: a big lime splat for YES, a smaller, quieter tomato one
 * for NO. It sits over its nearest positioned parent, ignores the pointer, plays once per `fire` value and does
 * not exist under reduced motion.
 */
export function InkSplash({ verdict, fire }: { verdict: boolean; fire: string | number }) {
  const reduced = useReduced();
  if (reduced) return null;
  return (
    <span
      key={`${fire}`}
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 200 200"
        width={verdict ? 'min(320px, 86%)' : 'min(190px, 54%)'}
        className={verdict ? 'ink-splash' : 'ink-splash ink-splash-soft'}
        role="presentation"
      >
        <g
          fill={verdict ? 'var(--color-lime)' : 'var(--color-tomato-deep)'}
          stroke="var(--color-ink)"
          strokeWidth="5"
          strokeLinejoin="round"
        >
          <path d={BLOB} />
          {DROPS.map(([cx, cy, r]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
          ))}
        </g>
      </svg>
    </span>
  );
}
