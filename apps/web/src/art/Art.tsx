import type { CSSProperties } from 'react';
import { art, type ArtName } from './manifest';

export type { ArtName };

interface ArtProps {
  name: ArtName;
  /** Rendered width in CSS px. Height follows the intrinsic ratio. Omit to let CSS size it. */
  width?: number;
  /** Text alternative. Leave undefined for decoration (the same state is written in text next to it). */
  alt?: string;
  /** Hero and above-the-fold art loads eagerly; everything else is lazy. */
  eager?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** One image from the generated manifest with its intrinsic size, so layout never shifts. */
export function Art({ name, width, alt, eager = false, className, style }: ArtProps) {
  const entry = art[name];
  return (
    <img
      src={entry.src}
      width={entry.w}
      height={entry.h}
      alt={alt ?? ''}
      aria-hidden={alt === undefined ? true : undefined}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className={className}
      style={{ ...(width ? { width, height: 'auto' } : null), maxWidth: '100%', ...style }}
    />
  );
}

export function artRatio(name: ArtName): number {
  const entry = art[name];
  return entry.w / entry.h;
}

export { art };
