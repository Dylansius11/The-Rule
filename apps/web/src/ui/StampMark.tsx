import type { ReactNode } from 'react';

interface StampMarkProps {
  tone: 'yes' | 'no' | 'soft';
  children: ReactNode;
  /** true: full slam (YES). 'small': lighter slam (NO). false: static. */
  slam?: boolean | 'small';
  size?: number;
}

/** The rubber stamp: rough ink edge, tilted, slams down from 2.6x. */
export function StampMark({ tone, children, slam = false, size }: StampMarkProps) {
  return (
    <span
      className="stamp-mark"
      data-v={tone}
      data-slam={slam === false ? undefined : String(slam)}
      style={size ? ({ '--stamp-fs': `${size}px` } as React.CSSProperties) : undefined}
    >
      {children}
    </span>
  );
}
