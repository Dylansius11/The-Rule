import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { roomPath, useNavMode } from '@/app/paths';
import { toUiError } from '@/chain/errors';
import { formatNear, shortHash } from '@/chain/format';
import { getRound } from '@/chain/views';
import { useNextSlot, useSeason } from '@/game';
import type { Mode } from '@/game/types';
import { PageHead } from '@/screens/shared/PageHead';
import { isActive, modeName, outcomeLabel, phaseLabel } from '@/screens/shared/round';
import { Button } from '@/ui/Button';
import { RadioChips } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { Segmented } from '@/ui/Segmented';
import { Tag } from '@/ui/Tag';

const cell = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));
const HISTORY_LIMIT = 30;

/** Season: the board for a mode and the history of its rounds, every row read from the chain. */
export function SeasonPage() {
  const [mode, setMode] = useState<Mode>(useNavMode());
  return (
    <div className="wrap pb-20 pt-7 md:pt-10">
      <PageHead
        title={
          <>
            The season <span className="text-grape">board</span>
          </>
        }
        kicker="seven rounds, one board"
        note="a season is a run of rounds. Solo and Team keep separate boards."
        underline="doodles/underline-grape"
        art="heron/vest"
        artWidth={110}
      />
      <div className="mt-6">
        <Segmented
          label="Mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 0 as Mode, label: 'Solo' },
            { value: 1 as Mode, label: 'Team' },
          ]}
        />
      </div>
      <Board mode={mode} />
      <RoundHistory mode={mode} />
    </div>
  );
}

function Board({ mode }: { mode: Mode }) {
  const [season, setSeason] = useState(0);
  const q = useSeason(mode, season);
  const rows = q.data && q.data.supported ? (q.data.rows as Record<string, unknown>[]) : [];
  const cols = rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];
  return (
    <section className="mt-9" aria-label={`${modeName(mode)} board`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="display text-[clamp(34px,5vw,48px)] leading-none">{modeName(mode)} board</h2>
        <RadioChips
          label="Season"
          value={season}
          onChange={setSeason}
          small
          options={[0, 1, 2].map(s => ({ value: s, label: `Season ${s}` }))}
        />
      </div>
      <div className="mt-5" aria-live="polite">
        {q.isLoading ? (
          <p className="display text-[36px]" aria-busy="true">
            Reading the board…
          </p>
        ) : q.isError ? (
          <ErrorCard error={toUiError(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data && !q.data.supported ? (
          <EmptyState title="This deployment keeps no season board" art="stickers/asleep" artWidth={150}>
            The rehearsal contracts do not expose a season view, so there is nothing honest to rank. Every
            round&apos;s plays are still public, and the history below is read straight from the chain.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="Nobody on the board yet" art="drip/asleep" artWidth={150}>
            No finished rounds in this season for the {modeName(mode)} board.
          </EmptyState>
        ) : (
          <InkBox className="overflow-x-auto p-4" fill="#fff" tilt={-0.3}>
            <table className="data-table">
              <caption className="sr-only">Season board</caption>
              <thead>
                <tr>
                  {cols.map(c => (
                    <th key={c} scope="col">
                      {c.replaceAll('_', ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map(c => (
                      <td key={c} className="break-all">
                        {cell(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </InkBox>
        )}
      </div>
    </section>
  );
}

/** One row per round, newest first, from real `get_round` reads. Each links to its ledger and, once opened, its verify page. */
function RoundHistory({ mode }: { mode: Mode }) {
  const slot = useNextSlot(mode);
  const count = slot.data?.roundId ?? 0;
  const ids = Array.from({ length: Math.min(count, HISTORY_LIMIT) }, (_, i) => count - 1 - i);
  const rounds = useQueries({
    queries: ids.map(id => ({
      queryKey: ['round', mode, id],
      queryFn: () => getRound(mode, id),
    })),
  });

  return (
    <section className="mt-12" aria-label={`${modeName(mode)} round history`}>
      <h2 className="display text-[clamp(34px,5vw,48px)] leading-none">Round history</h2>
      <p className="mt-1 text-[15px] font-semibold">
        {modeName(mode)} rounds on this deployment, read from the chain
        {count > HISTORY_LIMIT ? `. Showing the newest ${HISTORY_LIMIT} of ${count}` : ''}.
      </p>
      <div className="mt-4" aria-live="polite">
        {slot.isError ? (
          <ErrorCard error={toUiError(slot.error)} onRetry={() => void slot.refetch()} />
        ) : slot.isLoading ? (
          <p className="font-bold" aria-busy="true">
            Reading the rounds…
          </p>
        ) : count === 0 ? (
          <EmptyState title="No rounds yet" art="stickers/asleep" artWidth={130}>
            No {modeName(mode).toLowerCase()} round has started on this deployment.
          </EmptyState>
        ) : (
          <InkBox className="overflow-x-auto p-3 md:p-4" fill="#fff" tilt={-0.3}>
            <table className="data-table">
              <caption className="sr-only">{modeName(mode)} round history</caption>
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">Phase</th>
                  <th scope="col" className="max-md:hidden">
                    Outcome
                  </th>
                  <th scope="col">Plays</th>
                  <th scope="col" className="max-md:hidden">
                    Pot
                  </th>
                  <th scope="col" className="max-lg:hidden">
                    Commitment
                  </th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((q, i) => {
                  const id = ids[i]!;
                  const round = q.data ?? null;
                  if (!round)
                    return (
                      <tr key={id}>
                        <td>#{id}</td>
                        <td colSpan={6}>
                          {q.isError ? 'Could not read this round.' : q.isLoading ? 'Reading…' : 'No data.'}
                        </td>
                      </tr>
                    );
                  return (
                    <tr key={id}>
                      <td>#{id}</td>
                      <td>
                        <Tag tone={isActive(round) ? 'sun' : 'soft'}>{phaseLabel(round.phase)}</Tag>
                      </td>
                      <td className="max-md:hidden">{outcomeLabel(round)}</td>
                      <td>{round.logLen.toLocaleString('en-US')}</td>
                      <td className="max-md:hidden">{formatNear(round.pot, 3)} NEAR</td>
                      <td className="max-lg:hidden" title={round.commit ?? undefined}>
                        {round.commit ? shortHash(round.commit) : '–'}
                      </td>
                      <td>
                        <span className="flex flex-wrap gap-x-4">
                          <Link
                            to={roomPath(mode, 'ledger', id)}
                            className="inline-flex min-h-[44px] items-center font-extrabold underline decoration-2"
                          >
                            Ledger
                          </Link>
                          {round.rule ? (
                            <Link
                              to={roomPath(mode, 'verify', id)}
                              className="inline-flex min-h-[44px] items-center font-extrabold underline decoration-2"
                            >
                              Verify
                            </Link>
                          ) : (
                            <span className="inline-flex min-h-[44px] items-center text-ink-soft">
                              sealed
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </InkBox>
        )}
      </div>
      <div className="mt-6">
        <Button to={roomPath(mode)} variant="red">
          Play {modeName(mode)}
        </Button>
      </div>
    </section>
  );
}
