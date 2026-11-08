import type { CSSProperties, ElementType, HTMLAttributes, ReactNode, Ref } from 'react';

type Radius = 'blob' | 'blob-lg' | 'slip' | 'slab';
const RADIUS: Record<Radius, string> = {
  blob: 'var(--radius-blob)',
  'blob-lg': 'var(--radius-blob-lg)',
  slip: 'var(--radius-slip)',
  slab: 'var(--radius-slab)',
};

interface InkBoxProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** CSS colour for the fill, e.g. 'var(--color-sun)'. */
  fill?: string;
  radius?: Radius;
  tilt?: number;
  /** Thinner outline and tighter wobble for small parts. */
  small?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

/** A hand-inked surface. The wobble sits on a pseudo-layer, so the content stays sharp. */
export function InkBox({
  as: Tag = 'div',
  fill,
  radius = 'blob',
  tilt,
  small,
  className = '',
  style,
  children,
  ...rest
}: InkBoxProps) {
  const css: CSSProperties = {
    ...(fill ? ({ '--fill': fill } as CSSProperties) : null),
    '--r': RADIUS[radius],
    ...(tilt ? { transform: `rotate(${tilt}deg)` } : null),
    ...style,
  } as CSSProperties;
  return (
    <Tag className={`ink ${small ? 'ink-s' : ''} ${className}`} style={css} {...rest}>
      {children}
    </Tag>
  );
}
