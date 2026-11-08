import { useState } from 'react';
import { Link } from 'react-router';
import { DOCS_PATH } from '@/app/paths';
import { REPLAY_LIMIT, TRUST_SENTENCE } from '@/config/env';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

/** One slim line under the game: play-money note and the Trust model sheet. */
export function AppFooter() {
  const [open, setOpen] = useState(false);
  return (
    <footer className="border-t-[3px] border-ink bg-paper-2 px-4 py-2 text-center">
      <p className="mono text-[13px] font-bold">
        Testnet play money ·{' '}
        <Link
          to={DOCS_PATH}
          className="inline-flex min-h-[44px] items-center px-1 font-extrabold underline decoration-2 underline-offset-2"
        >
          Docs
        </Link>{' '}
        ·{' '}
        <button
          type="button"
          className="min-h-[44px] px-1 font-extrabold underline decoration-2 underline-offset-2"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          Trust model
        </button>
      </p>
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy="trust-title">
        <div className="p-6 md:p-8">
          <h2 id="trust-title" className="display text-[clamp(34px,6vw,48px)]">
            Trust model
          </h2>
          <p className="mt-3 text-[17px] font-bold">{TRUST_SENTENCE}</p>
          <p className="mt-3 text-[16px] font-semibold text-ink-soft">{REPLAY_LIMIT}</p>
          <p className="mt-3 text-[15px] font-semibold text-ink-soft">
            Testnet play money only. No price, return, liquidity or redemption promise for RULE.
          </p>
          <div className="mt-5">
            <Button variant="paper" size="sm" onClick={() => setOpen(false)} sound={false}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </footer>
  );
}
