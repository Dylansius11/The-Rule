import { Link } from 'react-router';
import { useSessionKey } from '@/chain/session/useSessionKey';
import { InkBox } from '@/ui/InkBox';

/** Tells the player, wherever they are, that the session key stopped and what happens next. */
export function SessionNotice() {
  const { notice, dismissNotice } = useSessionKey();
  if (!notice) return null;
  return (
    <div className="wrap mt-3">
      <InkBox className="p-4" fill="var(--color-sun)">
        <p className="font-extrabold" role="alert">
          {notice}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-5">
          <Link to="/account" className="min-h-[44px] py-2.5 font-extrabold underline decoration-2">
            Open session key settings
          </Link>
          <button
            type="button"
            className="min-h-[44px] font-extrabold underline decoration-2"
            onClick={dismissNotice}
          >
            Dismiss
          </button>
        </div>
      </InkBox>
    </div>
  );
}
