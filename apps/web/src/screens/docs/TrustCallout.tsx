import { Link } from 'react-router';
import { REPLAY_LIMIT, TRUST_SENTENCE } from '@/config/env';
import { InkBox } from '@/ui/InkBox';

/**
 * The one trust sentence, from `TRUST_SENTENCE`, plus the replay limit. Shown on the docs home and on every
 * Trust page. The Markdown pages never contain either sentence; they are written here, once, from the constants.
 */
export function TrustCallout({ link = true }: { link?: boolean }) {
  return (
    <InkBox
      as="aside"
      fill="var(--color-sun)"
      radius="blob-lg"
      className="doc-trust"
      aria-label="Trust statement"
    >
      <p className="hand text-[24px] leading-none">the sentence we stand behind</p>
      <p
        data-testid="trust-sentence"
        className="mt-2 text-[clamp(19px,2.2vw,22px)] font-extrabold leading-snug"
      >
        {TRUST_SENTENCE}
      </p>
      <p className="mt-3 text-[16px] font-bold leading-snug">{REPLAY_LIMIT}</p>
      {link ? (
        <p className="mt-3 text-[16px] font-extrabold">
          <Link to="/docs/trust/what-replay-proves" className="underline decoration-2 underline-offset-4">
            What replay proves, and what it does not
          </Link>
        </p>
      ) : null}
    </InkBox>
  );
}
