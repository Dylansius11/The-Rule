import { Link } from 'react-router';
import { BlotPeek } from '@/mascot/Blot';

/**
 * Blot peeking over the header rule beside the THE RULE wordmark. Always links to the landing page. The peek shows
 * from `md` by default; the game header passes `xl` because it also carries the wallet chips.
 */
export function Brand({ peekFrom = 'md' }: { peekFrom?: 'md' | 'xl' }) {
  const peek = peekFrom === 'xl' ? 'hidden xl:block' : 'hidden md:block';
  return (
    <Link
      to="/"
      className="flex shrink-0 items-end gap-2 self-end"
      aria-label="THE RULE, home"
      style={{ marginBottom: -4 }}
    >
      <span className={`${peek} w-[92px] shrink-0`}>
        <BlotPeek width={92} />
      </span>
      <span
        className="display poster mb-2 text-[26px] leading-none max-[359px]:text-[22px] xs:text-[30px] md:mb-3 md:text-[38px]"
        aria-hidden="true"
      >
        <span className="text-sun">THE</span> <span className="text-tomato">RULE</span>
      </span>
    </Link>
  );
}
