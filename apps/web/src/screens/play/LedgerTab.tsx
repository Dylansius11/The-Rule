import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { formatNear, formatRule } from '@/chain/format';
import { useLog, useRound } from '@/game';
import { Drip } from '@/mascot/Drip';
import { Button } from '@/ui/Button';
import { Chip, RadioChips } from '@/ui/Chip';
import { ErrorCard } from '@/ui/ErrorCard';
import { HashText } from '@/ui/HashText';
import { InkBox } from '@/ui/InkBox';
import { ProgressMeter } from '@/ui/ProgressMeter';
import { Tag, VerdictTag } from '@/ui/Tag';
import { RoundPicker } from '@/screens/shared/RoundPicker';
import { PageHead } from '@/screens/shared/PageHead';
import { pct } from '@/screens/shared/format';
import { downloadLog } from '@/screens/shared/exportLog';
import { isActive, modeName, pad3, phaseLabel } from '@/screens/shared/round';
import { useRoundSelection } from '@/screens/shared/useRoundSelection';
import { useRoom } from './room';

type Verdict = 'all' | 'yes' | 'no';
type Parity = 'all' | 'even' | 'odd';
type Sort = 'new' | 'old';

const GRID =
  'grid grid-cols-[52px_minmax(0,1fr)_96px] items-center gap-x-2 md:grid-cols-[64px_minmax(0,1.5fr)_84px_minmax(0,1fr)_64px_104px_150px]';

/** S2: the heron's ledger. Search and filter, virtualized crisp rows, completeness meter, export of exactly the filtered rows. */
export function LedgerTab() {
  const { mode } = useRoom();
  const sel = useRoundSelection(mode, 'latest');
  const round = useRound(mode, sel.roundId);
  const log = useLog(mode, sel.roundId, { follow: isActive(round.data ?? null) });
  const [q, setQ] = useState('');
  const [verdict, setVerdict] = useState<Verdict>('all');
  const [parity, setParity] = useState<Parity>('all');
  const [sort, setSort] = useState<Sort>('new');
  const [open, setOpen] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = log.rows.filter(r => {
      if (verdict !== 'all' && r.verdict !== (verdict === 'yes')) return false;
      if (parity !== 'all' && r.number % 2 !== (parity === 'even' ? 0 : 1)) return false;
      if (!needle) return true;
      return (
        r.word.toLowerCase().includes(needle) ||
        r.account.toLowerCase().includes(needle) ||
        pad3(r.number).includes(needle) ||
        String(r.number) === needle
      );
    });
    return sort === 'new' ? out.reverse() : out;
  }, [log.rows, q, verdict, parity, sort]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 46,
    overscan: 14,
  });
  const yes = rows.filter(r => r.verdict).length;
  const chosen = open === null ? null : (log.rows.find(r => r.logIdx === open) ?? null);
  const filtered = verdict !== 'all' || parity !== 'all' || q.trim() !== '';
  const base = `rule-${modeName(mode).toLowerCase()}-round-${sel.roundId ?? 'x'}-log${filtered ? '-filtered' : ''}`;

  return (
    <div className="wrap pb-20 pt-8 md:pt-12">
      <PageHead
        title={
          <>
            The <span className="text-grape">ledger</span>
          </>
        }
        kicker="the heron keeps it"
        note="every row is public. read it all."
        art="heron/vest"
        artWidth={130}
        underline="doodles/underline-grape"
      />

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <RoundPicker rounds={sel.rounds} value={sel.roundId} onChange={sel.setRound} />
        {round.data ? (
          <span className="flex flex-wrap items-center gap-3 text-[15px] font-bold">
            <Tag tone={isActive(round.data) ? 'sun' : 'soft'}>{phaseLabel(round.data.phase)}</Tag>
            <span className="mono">pot {formatNear(round.data.pot, 3)} NEAR</span>
          </span>
        ) : null}
      </div>

      {sel.roundId === null && !sel.loading ? (
        <div className="mt-8">
          <InkBox className="p-8 text-center">
            <h2 className="display text-[40px]">No rounds yet</h2>
            <p className="mt-2 font-bold">The ledger fills once the first round starts.</p>
          </InkBox>
        </div>
      ) : (
        <>
          <div className="mt-7">
            <ProgressMeter
              label="Completeness"
              value={log.loaded}
              max={log.total}
              unit="plays loaded"
              tone={log.complete ? 'lime' : 'pink'}
            />
            {log.complete ? (
              <p className="mt-1 text-[14px] font-bold">
                Every play of this round is loaded. Exports below are complete.
              </p>
            ) : (
              <p className="mt-1 text-[14px] font-bold">
                Still loading. Exports include only the rows loaded so far.
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3" role="group" aria-label="Filters">
            <div className="min-w-[220px] flex-1 md:max-w-[360px]">
              <label htmlFor="log-search" className="sr-only">
                Search by number, word or player
              </label>
              <input
                id="log-search"
                className="field"
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search number, word or player"
                autoComplete="off"
              />
            </div>
            <RadioChips
              label="Verdict"
              value={verdict}
              onChange={setVerdict}
              small
              options={[
                { value: 'all', label: 'all' },
                { value: 'yes', label: '✓ yes' },
                { value: 'no', label: '✗ no' },
              ]}
            />
            <RadioChips
              label="Number parity"
              value={parity}
              onChange={setParity}
              small
              options={[
                { value: 'all', label: 'any number' },
                { value: 'even', label: 'even' },
                { value: 'odd', label: 'odd' },
              ]}
            />
            <Chip pressed={sort === 'old'} small onClick={() => setSort(s => (s === 'new' ? 'old' : 'new'))}>
              oldest first
            </Chip>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="mono text-[14px] font-bold" aria-live="polite">
              {rows.length.toLocaleString('en-US')} of {log.rows.length.toLocaleString('en-US')} plays shown ·{' '}
              {pct(yes, rows.length)} accepted ({yes} YES, {rows.length - yes} NO)
            </p>
            <div className="flex gap-3">
              <Button
                variant="paper"
                size="sm"
                disabled={rows.length === 0}
                onClick={() => downloadLog(rows, base, 'csv')}
              >
                Export CSV
              </Button>
              <Button
                variant="paper"
                size="sm"
                disabled={rows.length === 0}
                onClick={() => downloadLog(rows, base, 'json')}
              >
                Export JSON
              </Button>
            </div>
          </div>

          {chosen ? (
            <InkBox className="mt-5 p-4" fill="var(--color-paper-2)" aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="display text-[30px]">
                  Play {chosen.logIdx}: {pad3(chosen.number)} {chosen.word}
                </h2>
                <Button variant="paper" size="sm" onClick={() => setOpen(null)}>
                  Close
                </Button>
              </div>
              <dl className="mono mt-2 grid gap-x-8 gap-y-1 text-[14px] font-bold sm:grid-cols-2">
                <div>
                  <dt className="inline text-ink-soft">verdict </dt>
                  <dd className="inline">
                    <VerdictTag verdict={chosen.verdict} />
                  </dd>
                </div>
                <div>
                  <dt className="inline text-ink-soft">player </dt>
                  <dd className="inline">
                    <HashText value={chosen.account} kind="account" full label="player account" />
                  </dd>
                </div>
                <div>
                  <dt className="inline text-ink-soft">sequence </dt>
                  <dd className="inline">{chosen.seq}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-soft">minute digit </dt>
                  <dd className="inline">{chosen.minuteDigit}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-soft">previous line </dt>
                  <dd className="inline">
                    {chosen.prev ? `${pad3(chosen.prev.number)} word #${chosen.prev.wordId}` : 'none'}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-ink-soft">logged mint </dt>
                  <dd className="inline">{formatRule(chosen.minted)} RULE</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline text-ink-soft">play key </dt>
                  <dd className="inline break-all">{chosen.playKey}</dd>
                </div>
              </dl>
            </InkBox>
          ) : null}

          {log.status === 'error' && log.error ? (
            <div className="mt-5">
              <ErrorCard error={log.error} onRetry={log.retry} />
            </div>
          ) : (
            <InkBox className="mt-5 p-2.5 md:p-4" fill="#fff" tilt={-0.3}>
              <div
                className={`${GRID} border-b-4 border-ink px-2 pb-2 pt-2 font-display text-[18px] font-black uppercase tracking-wider`}
                aria-hidden="true"
              >
                <span>#</span>
                <span className="max-md:hidden">Player</span>
                <span className="max-md:hidden">Number</span>
                <span className="md:hidden">Play</span>
                <span className="max-md:hidden">Word</span>
                <span className="max-md:hidden">Min</span>
                <span>Verdict</span>
                <span className="max-md:hidden">Logged mint</span>
              </div>
              <div
                ref={scroller}
                className="relative max-h-[min(66vh,640px)] overflow-auto"
                role="list"
                aria-label="Plays"
                aria-busy={log.status === 'loading'}
              >
                {log.status === 'loading' ? (
                  <p className="p-4 font-bold">Loading plays from the chain…</p>
                ) : rows.length === 0 ? (
                  <div className="flex items-center gap-4 p-4">
                    <Drip pose="asleep" width={120} />
                    <p className="font-bold">
                      {log.rows.length === 0
                        ? 'No plays in this round yet.'
                        : 'No play matches these filters.'}
                    </p>
                  </div>
                ) : (
                  <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
                    {virt.getVirtualItems().map(v => {
                      const r = rows[v.index]!;
                      return (
                        <div
                          key={r.logIdx}
                          role="listitem"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: v.size,
                            transform: `translateY(${v.start}px)`,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setOpen(r.logIdx)}
                            aria-label={`Play ${r.logIdx}: ${r.account}, ${pad3(r.number)} ${r.word}, ${r.verdict ? 'YES' : 'NO'}. Open details.`}
                            aria-pressed={open === r.logIdx}
                            className={`${GRID} mono h-full w-full border-b-2 border-dashed border-ink/30 px-2 text-left text-[14px] font-semibold hover:bg-sun/40 ${open === r.logIdx ? 'bg-sun/60' : ''}`}
                          >
                            <span>{r.logIdx}</span>
                            <span className="truncate max-md:hidden">{r.account}</span>
                            <span className="max-md:hidden">{pad3(r.number)}</span>
                            <span className="md:hidden">
                              {pad3(r.number)} {r.word}
                            </span>
                            <span className="truncate max-md:hidden">{r.word}</span>
                            <span className="max-md:hidden">{r.minuteDigit}</span>
                            <span>
                              <VerdictTag verdict={r.verdict} />
                            </span>
                            <span className="max-md:hidden">
                              {r.minted > 0n ? `${formatRule(r.minted).slice(0, 10)} RULE` : '–'}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </InkBox>
          )}
        </>
      )}
    </div>
  );
}
