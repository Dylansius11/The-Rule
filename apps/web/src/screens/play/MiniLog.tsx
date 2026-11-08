import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { roomPath } from '@/app/paths';
import type { useLog } from '@/game';
import type { Mode, Round } from '@/game/types';
import { Heron } from '@/mascot/Heron';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { VerdictTag } from '@/ui/Tag';
import { modeName, pad3, isActive } from '@/screens/shared/round';

type Log = ReturnType<typeof useLog>;
const SHOW = 6;

/** The newest plays, straight from the chain. A row that appears while you watch flashes sun. */
export function MiniLog({ mode, round, log }: { mode: Mode; round: Round | null; log: Log }) {
  const seen = useRef<number | null>(null);
  const newest = log.rows.length ? log.rows[log.rows.length - 1]!.logIdx : null;
  const flashFrom = seen.current;
  useEffect(() => {
    if (log.status === 'ready') seen.current = newest ?? -1;
  }, [log.status, newest]);

  const rows = log.rows.slice(-SHOW).reverse();
  return (
    <div className="wrap">
      <div className="relative flex items-end justify-between gap-4">
        <div>
          <h2 className="display text-[clamp(40px,6vw,72px)] leading-[0.85]">
            The newest <span className="text-grape">plays</span>
          </h2>
          <span className="hand mb-5 mt-1 block -rotate-1 text-[24px] md:text-[28px]">
            every row is on-chain. we hide nothing (except the one thing).
          </span>
        </div>
        <Heron pose="vest" width={104} className="mb-4 hidden shrink-0 sm:block" />
      </div>

      {log.status === 'error' && log.error ? (
        <ErrorCard error={log.error} onRetry={log.retry} />
      ) : (
        <InkBox className="p-3 md:p-5" tilt={-0.4} fill="#fff">
          <p className="mb-1 px-2 text-[15px] font-bold">
            {round
              ? `${modeName(mode)} round ${round.roundId} · ${isActive(round) ? 'newest plays' : 'final plays of the last round'}`
              : 'No round yet'}
          </p>
          <table className="data-table">
            <caption className="sr-only">Newest plays from the chain</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col" className="max-md:hidden">
                  Player
                </th>
                <th scope="col">Number</th>
                <th scope="col">Word</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {log.status === 'loading' ? (
                <tr>
                  <td colSpan={5} aria-busy="true">
                    Loading plays from the chain…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    {log.status === 'idle' ? 'No plays yet: no round exists.' : 'No plays yet in this round.'}
                  </td>
                </tr>
              ) : (
                rows.map(r => (
                  <tr
                    key={r.logIdx}
                    className={flashFrom !== null && r.logIdx > flashFrom ? 'fresh-row' : undefined}
                  >
                    <td>{r.logIdx}</td>
                    <td className="max-w-[220px] truncate max-md:hidden" title={r.account}>
                      {r.account}
                    </td>
                    <td>{pad3(r.number)}</td>
                    <td>{r.word}</td>
                    <td>
                      <VerdictTag verdict={r.verdict} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </InkBox>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button to={roomPath(mode, 'ledger', round?.roundId)} variant="grape">
          Open the full ledger
        </Button>
        <span className="text-[15px] font-semibold">
          Filter, search, export CSV or JSON.{' '}
          <Link
            to={roomPath(mode, 'verify')}
            className="font-extrabold underline decoration-2 underline-offset-2"
          >
            Replay a settled round
          </Link>
          .
        </span>
      </div>
    </div>
  );
}
