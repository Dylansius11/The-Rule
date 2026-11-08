import { useMemo } from 'react';

/** Deterministic pseudo-random in 0..1 so a given edge always has the same hand-drawn shape. */
function rng(seed: number) {
  let s = seed * 7 + 3;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function wavePath(seed: number, amp: number, n = 48): string {
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++)
    pts.push([(i / n) * 1440, 38 + Math.sin(i * 0.42 + seed) * amp + (r() - 0.5) * 7]);
  let line = `M${pts[0]![0]} ${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    line += ` Q${x0 + 15} ${y0.toFixed(1)} ${(x0 + x1) / 2} ${((y0 + y1) / 2).toFixed(1)}`;
  }
  return `${line} T1440 ${pts[n]![1].toFixed(1)}`;
}

interface WaveEdgeProps {
  /** Fill of the section this edge belongs to (its top edge rises into the section above). */
  fill: string;
  amp?: number;
  seed?: number;
  className?: string;
}

/** A hand-drawn wave along the top of a section. Place as the first child of a `relative` section. */
export function WaveEdge({ fill, amp = 12, seed = 1, className = '' }: WaveEdgeProps) {
  const d = useMemo(() => wavePath(seed, amp), [seed, amp]);
  return (
    <svg
      className={`pointer-events-none absolute left-0 z-[2] w-full ${className}`}
      style={{ top: -79, height: 80 }}
      viewBox="0 0 1440 80"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={`${d} L1440 82 L0 82 Z`} fill={fill} />
      <path
        d={d}
        fill="none"
        stroke="#141210"
        strokeWidth="4"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        style={{ filter: 'url(#ink-wob2)' }}
      />
    </svg>
  );
}
