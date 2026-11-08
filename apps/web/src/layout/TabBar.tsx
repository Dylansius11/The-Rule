import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import { config } from '@/config/env';
import { useMotionPrefs } from '@/motion/prefs';
import { Button } from '@/ui/Button';
import { MORE, MoreIcon, NAV } from './nav';

/** Mobile bottom tab bar (Play, Log, Guess, Reveal, Wallet) with a More sheet (Team, Season, Demo, motion). */
export function TabBar() {
  const sheet = useRef<HTMLDialogElement>(null);
  const loc = useLocation();
  const { userReduced, setUserReduced } = useMotionPrefs();

  useEffect(() => {
    sheet.current?.close();
  }, [loc.pathname]);

  const moreActive = MORE.some(m => loc.pathname.startsWith(m.to));
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t-[3.5px] border-ink bg-paper md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', minHeight: 'var(--tabbar-h)' }}
      >
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} className="tab-link">
            {n.icon}
            {n.label}
          </NavLink>
        ))}
        <button
          type="button"
          className="tab-link"
          aria-haspopup="dialog"
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => sheet.current?.showModal()}
        >
          <MoreIcon />
          More
        </button>
      </nav>

      <dialog
        ref={sheet}
        aria-label="More"
        className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-[22px] border-[3.5px] border-b-0 border-ink bg-paper p-5 text-ink backdrop:bg-ink/60 md:hidden"
        onClick={e => {
          if (e.target === sheet.current) sheet.current?.close();
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-[34px]">More</h2>
          <button
            type="button"
            className="min-h-[44px] min-w-[44px] rounded-full border-[3px] border-ink bg-sun font-display text-[22px] font-black"
            onClick={() => sheet.current?.close()}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ul className="grid gap-3">
          {MORE.map(m => (
            <li key={m.to}>
              <NavLink
                to={m.to}
                className="flex min-h-[56px] flex-col justify-center rounded-lg border-[3px] border-ink bg-white px-4 py-2 no-underline"
              >
                <span className="display text-[26px] leading-none">{m.label}</span>
                <span className="text-[15px] font-semibold">{m.note}</span>
              </NavLink>
            </li>
          ))}
          <li className="rounded-lg border-[3px] border-ink bg-paper-2 px-4 py-3">
            <div className="display text-[26px] leading-none">Demo Mode</div>
            <p className="mt-1 text-[15px] font-semibold">
              {config.demo
                ? 'A separate demo instance is configured: preselected rule, own pot and token.'
                : 'Not available yet: no demo instance is deployed. The real sealed round is the only one running.'}
            </p>
            <div className="mt-2">
              <Button
                variant="paper"
                size="sm"
                disabled
                title={config.demo ? undefined : 'No demo instance exists yet'}
              >
                Switch to Demo
              </Button>
            </div>
          </li>
          <li className="flex min-h-[56px] items-center justify-between gap-3 rounded-lg border-[3px] border-ink bg-white px-4 py-2">
            <label htmlFor="rm-more" className="font-extrabold">
              Reduce motion
            </label>
            <input
              id="rm-more"
              type="checkbox"
              className="h-7 w-7 accent-tomato"
              checked={userReduced}
              onChange={e => setUserReduced(e.target.checked)}
            />
          </li>
        </ul>
      </dialog>
    </>
  );
}
