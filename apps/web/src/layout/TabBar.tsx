import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { DOCS_PATH, roomPath, useNavMode } from '@/app/paths';
import { useSound } from '@/audio';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { useDeploymentChoice } from './demo';
import { useGuide } from './guide';
import { MoreIcon, ROOM_TABS } from './nav';
import { SettingsPanel } from './SettingsPanel';
import { active, config } from '@/config/env';
import { useWallet } from '@/game';

/** Mobile bottom bar for the game: the four room tabs and More (Season, Account, Team crew, guide, settings, Demo). */
export function TabBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const mode = useNavMode();
  const { show } = useGuide();
  const { choose, dialog } = useDeploymentChoice();
  const wallet = useWallet();
  const { play } = useSound();

  useEffect(() => setMoreOpen(false), [pathname]);

  const moreActive =
    pathname.startsWith('/season') ||
    pathname.startsWith('/account') ||
    pathname.startsWith(DOCS_PATH) ||
    pathname.endsWith('/crew');
  return (
    <>
      <nav
        aria-label="Game"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t-[3.5px] border-ink bg-paper md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', minHeight: 'var(--tabbar-h)' }}
      >
        {ROOM_TABS.map(t => (
          <NavLink
            key={t.tab}
            to={roomPath(mode, t.tab)}
            end={t.tab === 'stamp'}
            className="tab-link"
            onClick={() => play('nav')}
          >
            {t.icon}
            {t.label}
          </NavLink>
        ))}
        <button
          type="button"
          className="tab-link"
          aria-haspopup="dialog"
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setMoreOpen(true)}
        >
          <MoreIcon />
          More
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} labelledBy="more-title" kind="sheet">
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="more-title" className="display text-[34px]">
              More
            </h2>
            <button
              type="button"
              className="grid min-h-[44px] min-w-[44px] place-items-center rounded-full border-[3px] border-ink bg-sun font-display text-[22px] font-black"
              onClick={() => setMoreOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <ul className="grid gap-3">
            <li>
              <NavLink to="/season" className="more-link">
                <span className="display text-[26px] leading-none">Season</span>
                <span className="text-[15px] font-semibold">Boards and the history of every round.</span>
              </NavLink>
            </li>
            <li>
              <NavLink to="/account" className="more-link">
                <span className="display text-[26px] leading-none">Account</span>
                <span className="text-[15px] font-semibold">Wallet, credit, RULE and claims.</span>
              </NavLink>
            </li>
            <li>
              <NavLink to={DOCS_PATH} className="more-link">
                <span className="display text-[26px] leading-none">Docs</span>
                <span className="text-[15px] font-semibold">
                  Guides, costs, trust and a file for your agent.
                </span>
              </NavLink>
            </li>
            <li>
              <NavLink to={roomPath(1, 'crew')} className="more-link">
                <span className="display text-[26px] leading-none">Team crew</span>
                <span className="text-[15px] font-semibold">Roster, vault and settle for your team.</span>
              </NavLink>
            </li>
            <li>
              <Button
                variant="paper"
                block
                onClick={() => {
                  setMoreOpen(false);
                  show();
                }}
              >
                How to play
              </Button>
            </li>
            <li className="rounded-lg border-[3px] border-ink bg-paper-2 px-4 py-3">
              <div className="display text-[26px] leading-none">Demo Mode</div>
              <p className="mt-1 text-[15px] font-semibold">
                {config.demo
                  ? 'A separate demo instance: preselected rule, its own pot and token.'
                  : 'Not configured in this build. You stay on the current deployment.'}
              </p>
              <div className="mt-2">
                <Button
                  variant="paper"
                  size="sm"
                  onClick={() => choose(active.kind === 'demo' ? 'main' : 'demo')}
                >
                  {active.kind === 'demo' ? 'Back to the real game' : 'Switch to Demo'}
                </Button>
              </div>
            </li>
            {wallet.status === 'connected' && wallet.accountId ? (
              <li className="rounded-lg border-[3px] border-ink bg-white px-4 py-3">
                <p className="font-mono text-[12px] font-bold uppercase tracking-wide text-ink-soft">
                  Connected · testnet
                </p>
                <p className="mt-1 break-all text-[17px] font-extrabold">{wallet.accountId}</p>
                <div className="mt-2">
                  <Button
                    variant="red"
                    size="sm"
                    onClick={() => {
                      setMoreOpen(false);
                      void wallet.disconnect();
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              </li>
            ) : null}
            <li className="rounded-lg border-[3px] border-ink bg-white px-4 py-3">
              <h3 className="display mb-1 text-[26px] leading-none">Settings</h3>
              <SettingsPanel onNavigate={() => setMoreOpen(false)} />
            </li>
          </ul>
        </div>
      </Dialog>
      {dialog}
    </>
  );
}
