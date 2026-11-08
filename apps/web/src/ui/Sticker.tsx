import type { ReactNode } from 'react';
import { InkBox } from './InkBox';

type Tone = 'paper' | 'sun' | 'pink' | 'lime' | 'grape';
const FILL: Record<Tone, string> = {
  paper: 'var(--color-paper)',
  sun: 'var(--color-sun)',
  pink: 'var(--color-bubblegum)',
  lime: 'var(--color-lime)',
  grape: 'var(--color-grape)',
};

interface StickerProps {
  label: string;
  children: ReactNode;
  tone?: Tone;
  tilt?: number;
  mono?: boolean;
  className?: string;
}

/** A slapped-on stat: small mono label over a loud value. Render inside a <dl>. */
export function StatSticker({
  label,
  children,
  tone = 'paper',
  tilt = 0,
  mono,
  className = '',
}: StickerProps) {
  return (
    <InkBox
      fill={FILL[tone]}
      radius="blob-lg"
      tilt={tilt}
      className={`sticker-stat ${className}`}
      style={tone === 'grape' ? { color: '#fff' } : undefined}
    >
      <dt>{label}</dt>
      <dd className={mono ? 'mono !text-[20px] !font-bold !normal-case' : ''}>{children}</dd>
    </InkBox>
  );
}
