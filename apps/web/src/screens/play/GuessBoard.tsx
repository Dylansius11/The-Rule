import { toUiError } from '@/chain/errors';
import { formatNear, shortHash } from '@/chain/format';
import { useCommits } from '@/game';
import type { Commit, Mode, Round } from '@/game/types';
import { Drip } from '@/mascot/Drip';
import { ErrorCard } from '@/ui/ErrorCard';
import { Tag } from '@/ui/Tag';
import { STATUS_WORDS, boardRows, boardSummary } from './boardData';

const TONE: Record<Commit['status'], 'soft' | 'sun' | 'yes' | 'no' | 'pink'> = {
  Committed: 'sun',
  Checking: 'pink',
  Correct: 'yes',
  Wrong: 'no',
  Refunded: 'soft',
  Unrevealed: 'soft',
};

/**
 * Who has sealed a guess this round, in commit order, with each guess's status. The guess itself stays a hash until
 * its owner reveals it, so this shows that and how many have guessed, never what. Polls with the round.
 */
export function GuessBoard({
  mode,
  round,
  account,
}: {
  mode: Mode;
  round: Round | null;
  account: string | null;
}) {
  const commits = useCommits(mode, round?.roundId ?? null);
  if (round === null) return <p className="font-bold">No round yet, so nothing is sealed.</p>;
  if (commits.isError) {
    return <ErrorCard error={toUiError(commits.error)} onRetry={() => void commits.refetch()} />;
  }
  if (commits.isPending) {
    return (
      <p className="font-bold" aria-busy="true">
        Reading sealed guesses from the chain…
      </p>
    );
  }
  const list = commits.data ?? [];
  const rows = boardRows(list, account);
  const s = boardSummary(list);
  const parts = [
    s.sealed ? `${s.sealed} sealed` : null,
    s.checking ? `${s.checking} being checked` : null,
    s.correct ? `${s.correct} correct` : null,
    s.wrong ? `${s.wrong} wrong` : null,
    s.refunded ? `${s.refunded} refunded` : null,
    s.unrevealed ? `${s.unrevealed} never revealed` : null,
  ].filter(Boolean);

  return (
    <div>
      <p className="mono text-[14px] font-bold" aria-live="polite">
        {s.total === 0
          ? 'No guess has been sealed in this round yet.'
          : `${s.total} guess${s.total === 1 ? '' : 'es'} · ${parts.join(' · ')}`}
      </p>
      {rows.length === 0 ? (
        <div className="mt-3 flex items-center gap-4">
          <Drip pose="asleep" width={96} />
          <p className="font-bold">Be the first to seal one. Nobody else can see what you wrote.</p>
        </div>
      ) : (
        <ol
          className="mt-3 grid max-h-[420px] grid-cols-[minmax(0,1fr)] gap-2.5 overflow-auto pr-1"
          aria-label="Sealed guesses"
        >
          {rows.map(row => (
            <li
              key={row.commitSeq}
              className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border-[3px] border-ink px-3 py-2.5 ${row.mine ? 'bg-sun/60' : 'bg-paper'}`}
            >
              <span className="mono grid size-9 shrink-0 place-items-center rounded-full border-[3px] border-ink bg-white text-[14px] font-extrabold">
                {row.place}
              </span>
              <div className="min-w-[11rem] flex-1">
                <p className="truncate font-extrabold">
                  {row.who}
                  {row.mine ? <span className="ml-2 text-[13px] text-tomato-deep">you</span> : null}
                  {row.team !== null ? <span className="ml-2 text-[13px]">team #{row.team}</span> : null}
                </p>
                <p className="mono text-[12px] font-bold text-ink-soft [overflow-wrap:anywhere]">
                  sealed {shortHash(row.hash)} · stake {formatNear(row.stake, 3)} NEAR
                </p>
              </div>
              <Tag tone={TONE[row.status]} className="shrink-0">
                {row.leads ? '★ ' : ''}
                {STATUS_WORDS[row.status]}
              </Tag>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[14px] font-semibold text-ink-soft">
        Only a hash is public until its owner reveals the guess. The earliest correct commit wins, so the
        order here is the order that counts.
      </p>
    </div>
  );
}
