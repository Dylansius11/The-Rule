import type { ReactNode } from 'react';
import { WaveEdge } from './WaveEdge';

type Tone = 'paper' | 'paper2' | 'sun' | 'ink' | 'grape' | 'bubblegum';
const FILL: Record<Tone, string> = {
  paper: '#FFFBEA',
  paper2: '#F6EFD3',
  sun: '#FFE814',
  ink: '#141210',
  grape: '#6E3BFF',
  bubblegum: '#FF7FA8',
};
const TEXT: Record<Tone, string> = {
  paper: 'text-ink',
  paper2: 'text-ink',
  sun: 'text-ink',
  ink: 'text-paper',
  grape: 'text-white',
  bubblegum: 'text-ink',
};

interface BandProps {
  tone?: Tone;
  /** Draw the hand-inked wave along the top. */
  edge?: boolean;
  amp?: number;
  seed?: number;
  id?: string;
  label?: string;
  className?: string;
  children: ReactNode;
}

/** A full-width page band with a hand-drawn wave edge. */
export function Band({
  tone = 'paper',
  edge = true,
  amp = 12,
  seed = 1,
  id,
  label,
  className = '',
  children,
}: BandProps) {
  return (
    <section
      id={id}
      aria-label={label}
      className={`relative ${TEXT[tone]} ${className}`}
      style={{ background: FILL[tone] }}
    >
      {edge ? <WaveEdge fill={FILL[tone]} amp={amp} seed={seed} /> : null}
      {children}
    </section>
  );
}
