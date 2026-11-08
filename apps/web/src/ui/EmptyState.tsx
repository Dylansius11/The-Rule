import type { ReactNode } from 'react';
import { Art } from '@/art/Art';
import type { ArtName } from '@/art/manifest';
import { InkBox } from './InkBox';

interface EmptyStateProps {
  art?: ArtName;
  artWidth?: number;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  fill?: string;
  className?: string;
}

/** An honest empty result: a character asleep or peeking, one sentence of what is true, next steps. */
export function EmptyState({
  art = 'stickers/asleep',
  artWidth = 150,
  title,
  children,
  actions,
  fill,
  className = '',
}: EmptyStateProps) {
  return (
    <InkBox fill={fill} className={`flex flex-col items-center gap-3 px-5 py-8 text-center ${className}`}>
      <Art name={art} width={artWidth} />
      <h3 className="display text-[34px] leading-[0.95]">{title}</h3>
      {children ? <div className="max-w-[46ch] text-[17px] font-semibold">{children}</div> : null}
      {actions ? <div className="mt-1 flex flex-wrap justify-center gap-4">{actions}</div> : null}
    </InkBox>
  );
}
