import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { modeOf, rememberMode, roomPath, slugOf, type RoomTab } from '@/app/paths';
import { formatNear } from '@/chain/format';
import { useLatestRound } from '@/game';
import type { Mode } from '@/game/types';
import { ROOM_TABS } from '@/layout/nav';
import { Segmented } from '@/ui/Segmented';
import { RoundStatusTag } from '@/screens/shared/RoundTimer';
import type { Room } from './room';

const tabOf = (pathname: string): RoomTab => {
  const last = pathname.split('/')[3];
  return last === 'ledger' || last === 'guess' || last === 'verify' || last === 'crew' ? last : 'stamp';
};

/**
 * The round room. One mode (Solo or Team), one switch between them, four tabs: Stamp, Ledger, Guess, Verify
 * (and the Crew desk in Team). Switching mode keeps the tab; each mode has its own rule, pot, log and board.
 */
export function RoomLayout() {
  const { mode: slug } = useParams();
  const mode: Mode = modeOf(slug) ?? 0;
  const latest = useLatestRound(mode);
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const tab = tabOf(pathname);
  const round = latest.data ?? null;
  const keep = search.get('round');

  useEffect(() => rememberMode(mode), [mode]);

  const context: Room = { mode, slug: slugOf(mode), latest };
  const tabs = mode === 1 ? [...ROOM_TABS, { tab: 'crew' as const, label: 'Crew', icon: null }] : ROOM_TABS;

  return (
    <>
      <div className="sticky z-20 border-b-[3.5px] border-ink bg-paper-2" style={{ top: 'var(--header-h)' }}>
        <div className="wrap flex items-center gap-x-5 py-2 md:py-1.5">
          <Segmented
            label="Mode"
            value={mode}
            onChange={m => navigate(roomPath(m, tab === 'crew' ? 'stamp' : tab))}
            options={[
              { value: 0 as Mode, label: 'Solo' },
              { value: 1 as Mode, label: 'Team' },
            ]}
          />
          <nav className="hidden items-center gap-1 md:flex lg:gap-3" aria-label="Round room">
            {tabs.map(t => {
              const withRound = (t.tab === 'ledger' || t.tab === 'verify') && keep !== null;
              return (
                <NavLink
                  key={t.tab}
                  to={roomPath(mode, t.tab, withRound ? Number(keep) : null)}
                  end={t.tab === 'stamp'}
                  className="room-tab"
                >
                  {t.label}
                </NavLink>
              );
            })}
          </nav>
          <p
            className="mono ml-auto flex items-center gap-2 text-[13px] font-bold max-md:text-[12px] md:hidden lg:flex"
            aria-label="Latest round"
            aria-busy={latest.isLoading}
          >
            {round ? (
              <>
                <span className="max-sm:hidden">
                  {slugOf(mode)} · round {round.roundId}
                </span>
                <RoundStatusTag round={round} ticking />
                <span className="hidden lg:inline">pot {formatNear(round.pot, 3)} NEAR</span>
              </>
            ) : latest.isLoading ? (
              'asking the chain…'
            ) : latest.isError ? (
              'could not read the round'
            ) : (
              `no ${slugOf(mode)} round yet`
            )}
          </p>
        </div>
      </div>
      <Outlet context={context} />
    </>
  );
}
