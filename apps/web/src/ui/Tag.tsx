import type { ReactNode } from 'react';

type TagTone = 'yes' | 'no' | 'soft' | 'sun' | 'grape' | 'pink';

export function Tag({
  tone = 'soft',
  tilt,
  children,
  className = '',
}: {
  tone?: TagTone;
  tilt?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`tag ${className}`} data-v={tone} data-tilt={tilt ? 'true' : undefined}>
      {children}
    </span>
  );
}

/** YES / NO always carries a shape and a word, never colour alone. */
export function VerdictTag({ verdict, tilt }: { verdict: boolean; tilt?: boolean }) {
  return (
    <Tag tone={verdict ? 'yes' : 'no'} tilt={tilt}>
      <span aria-hidden="true">{verdict ? '✓' : '✗'}</span>
      {verdict ? 'YES' : 'NO'}
    </Tag>
  );
}
