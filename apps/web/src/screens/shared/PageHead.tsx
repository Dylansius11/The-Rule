import type { ReactNode } from 'react';
import { Art } from '@/art/Art';
import type { ArtName } from '@/art/manifest';
import { Doodle } from '@/ui/Doodle';

interface PageHeadProps {
  title: ReactNode;
  /** Hand-lettered aside above the title. */
  kicker?: string;
  note?: string;
  art?: ArtName;
  artWidth?: number;
  underline?: 'doodles/underline-red' | 'doodles/underline-grape';
  children?: ReactNode;
}

/** Page heading: kicker aside, poster title with a hand underline, optional character at the right. */
export function PageHead({
  title,
  kicker,
  note,
  art,
  artWidth = 150,
  underline = 'doodles/underline-red',
  children,
}: PageHeadProps) {
  return (
    <div className="relative flex items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker ? <span className="hand mb-1 block -rotate-2 text-[26px] leading-none">{kicker}</span> : null}
        <h1 className="display text-[clamp(48px,7.5vw,88px)] leading-[0.85]">{title}</h1>
        <Doodle name={underline} size={190} className="-mt-1 block" />
        {note ? <p className="hand -rotate-1 text-[24px] leading-tight">{note}</p> : null}
        {children}
      </div>
      {art ? (
        <div className="hidden shrink-0 sm:block">
          <Art name={art} width={artWidth} eager />
        </div>
      ) : null}
    </div>
  );
}
