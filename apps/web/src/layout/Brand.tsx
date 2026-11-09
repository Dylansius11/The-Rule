import { Link } from 'react-router';
import { BlotPeek } from '@/mascot/Blot';

/** Blot peeking over the header rule beside the THE RULE wordmark. Always links to the landing page. */
export function Brand() {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-end gap-2 self-end"
      aria-label="THE RULE, home"
      style={{ marginBottom: -4 }}
    >
      <span className="hidden w-[92px] shrink-0 md:block">
        <BlotPeek width={92} />
      </span>
      <span
        className="display poster mb-2 text-[30px] leading-none md:mb-3 md:text-[38px]"
        aria-hidden="true"
      >
        <span className="text-sun">THE</span> <span className="text-tomato">RULE</span>
      </span>
    </Link>
  );
}
