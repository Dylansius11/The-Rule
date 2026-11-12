import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { roomPath } from '@/app/paths';
import { useCommits, useWallet } from '@/game';
import type { useLog } from '@/game';
import type { Mode, Round } from '@/game/types';
import { useMedia } from '@/layout/useMedia';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { Segmented } from '@/ui/Segmented';
import { VerdictTag } from '@/ui/Tag';
import { modeName, pad3, isActive } from '@/screens/shared/round';
import { GuessBoard } from './GuessBoard';

type Log = ReturnType<typeof useLog>;
type View = 'plays' | 'guesses';

/** Rows shown beside the desk on a wide screen and when the feed is opened; the folded phone feed shows a few. */
const FULL = 8;
const FOLDED = 3;

/**
 * What everyone else is stamping, right next to the desk: the newest plays straight from the chain, or who has
 * sealed a guess. Beside the desk from 1280 px; under the stamp button on smaller screens, folded to the newest few
 * with a button to open it. A row that appears while you watch flashes sun, and your own rows say so.
 */
export function MiniLog({ mode, round, log }: { mode: Mode; round: Round | null; log: Log }) {
  const seen = useRef<number | null>(null);
  const [view, setView] = useState<View>('plays');
  const [open, setOpen] = useState(false);
  const wide = useMedia('(min-width: 1280px)');
  const { accountId } = useWallet();
  const commits = useCommits(mode, round?.roundId ?? null);
  const newest = log.rows.length ? log.rows[log.rows.length - 1]!.logIdx : null;
  const flashFrom = seen.current;
  useEffect(() => {
    if (log.status === 'ready') seen.current = newest ?? -1;
  }, [log.status, newest]);

  const full = wide || open;
  const rows = log.rows.slice(-(full ? FULL : FOLDED)).reverse();
  const plays = view === 'plays';
  const hidden = log.rows.length - rows.length;
  const live = isActive(round);

  return (
    <aside
      aria-label="Live plays from everyone"
      className="min-w-0 xl:sticky xl:col-start-2 xl:row-span-2 xl:row-start-1"
      style={{ top: 'calc(var(--header-h) + 68px)' }}
    >
      <InkBox className="p-3.5 md:p-5" fill="#fff" tilt={0.4}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="display text-[clamp(30px,4vw,38px)] leading-[0.9]">
            {plays ? (
              <>
                Live <span className="text-grape">plays</span>
              </>
            ) : (
              <>
                Sealed <span className="text-grape">guesses</span>
              </>
            )}
          </h2>
          <Segmented
            label="Newest activity"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'plays', label: `Plays${log.rows.length ? ` ${log.rows.length}` : ''}` },
              { value: 'guesses', label: `Guesses${commits.data ? ` ${commits.data.length}` : ''}` },
            ]}
          />
        </div>

        {!plays ? (
          <div className="mt-3">
            <GuessBoard mode={mode} round={round} account={accountId} />
          </div>
        ) : log.status === 'error' && log.error ? (
          <div className="mt-3">
            <ErrorCard error={log.error} onRetry={log.retry} />
          </div>
        ) : (
          <>
            <p className="mono mt-2 text-[13px] font-bold text-ink-soft">
              {round
                ? `${modeName(mode)} round ${round.roundId} · ${live ? 'newest first' : 'final plays of the last round'}`
                : 'No round yet'}
            </p>
            {log.status === 'loading' ? (
              <p className="mt-3 font-bold" aria-busy="true">
                Loading plays from the chain…
              </p>
            ) : rows.length === 0 ? (
              <p className="mt-3 font-bold">
                {log.status === 'idle' ? 'No plays yet: no round exists.' : 'No plays yet in this round.'}
              </p>
            ) : (
              <ol className="mt-2" aria-label="Newest plays">
                {rows.map(r => {
                  const mine = accountId !== null && r.account === accountId;
                  return (
                    <li
                      key={r.logIdx}
                      className={`feed-row grid grid-cols-[2.6rem_minmax(0,1fr)_auto] items-center gap-x-2 border-b-2 border-dashed border-ink/30 px-1 py-2 last:border-b-0 ${mine ? 'bg-sun/60' : ''} ${flashFrom !== null && r.logIdx > flashFrom ? 'fresh-row' : ''}`}
                    >
                      <span className="mono text-[13px] font-bold text-ink-soft">#{r.logIdx}</span>
                      <span className="min-w-0">
                        <span className="mono block text-[15px] font-extrabold">
                          {pad3(r.number)} · {r.word}
                        </span>
                        <span
                          className="mono block truncate text-[12px] font-bold text-ink-soft"
                          title={r.account}
                        >
                          {mine ? 'you' : r.account}
                        </span>
                      </span>
                      <VerdictTag verdict={r.verdict} />
                    </li>
                  );
                })}
              </ol>
            )}
            {!wide && log.rows.length > FOLDED ? (
              <button
                type="button"
                className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full border-[3px] border-ink bg-paper-2 px-4 font-display text-[18px] font-black uppercase tracking-wide"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
              >
                {open ? 'Show fewer' : `Show ${Math.min(FULL, log.rows.length) - FOLDED} more`}
              </button>
            ) : null}
            {wide && hidden > 0 ? (
              <p className="mono mt-2 text-[12px] font-bold text-ink-soft">
                {hidden} older {hidden === 1 ? 'play' : 'plays'} in the full ledger
              </p>
            ) : null}
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button to={roomPath(mode, 'ledger', round?.roundId)} variant="grape" size="sm">
            Open the full ledger
          </Button>
          <Link
            to={roomPath(mode, 'verify')}
            className="text-[14px] font-extrabold underline decoration-2 underline-offset-2"
          >
            Replay a settled round
          </Link>
        </div>
      </InkBox>
    </aside>
  );
}
