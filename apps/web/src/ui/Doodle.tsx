import type { CSSProperties } from 'react';
import { Art } from '@/art/Art';
import type { ArtName } from '@/art/manifest';

type DoodleName = Extract<ArtName, `doodles/${string}`>;

interface DoodleProps {
  name: DoodleName;
  /** Rendered width in px. */
  size?: number;
  rot?: number;
  /** Absolute placement in percent of the nearest positioned parent. */
  x?: number | string;
  y?: number | string;
  right?: number | string;
  bottom?: number | string;
  twinkle?: boolean;
  float?: boolean;
  delay?: number;
  className?: string;
  /** A doodle that carries meaning gets text; decoration stays hidden from assistive tech. */
  alt?: string;
  style?: CSSProperties;
}

const pct = (v: number | string | undefined) => (typeof v === 'number' ? `${v}%` : v);

/** Decorative doodle: absolute when x/y are given, inline otherwise. */
export function Doodle({
  name,
  size = 48,
  rot = 0,
  x,
  y,
  right,
  bottom,
  twinkle,
  float,
  delay = 0,
  className = '',
  alt,
  style,
}: DoodleProps) {
  const abs = x !== undefined || y !== undefined || right !== undefined || bottom !== undefined;
  const css = {
    ...(abs
      ? {
          position: 'absolute',
          left: pct(x),
          top: pct(y),
          right: pct(right),
          bottom: pct(bottom),
          pointerEvents: 'none',
        }
      : null),
    '--rot': `${rot}deg`,
    '--d': `${delay}s`,
    transform: `rotate(${rot}deg)`,
    ...style,
  } as CSSProperties;
  return (
    <span
      className={`${abs ? '' : 'inline-block'} ${twinkle ? 'twinkle' : ''} ${float ? 'float-y' : ''} ${className}`}
      style={css}
    >
      <Art name={name} width={size} alt={alt} />
    </span>
  );
}

/** A scatter of stars for section backgrounds. Positions are fixed so the layout never jumps. */
export function StarField({
  spots,
  className = '',
}: {
  spots: readonly { x: number; y: number; s: number; r: number; n?: DoodleName }[];
  className?: string;
}) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {spots.map((p, i) => (
        <Doodle
          key={i}
          name={p.n ?? 'doodles/star-yellow'}
          x={p.x}
          y={p.y}
          size={p.s}
          rot={p.r}
          twinkle
          delay={i * 0.35}
          style={{ ['--t' as string]: `${2.6 + (i % 4) * 0.5}s` }}
        />
      ))}
    </div>
  );
}
