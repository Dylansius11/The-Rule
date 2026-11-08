import { useState } from 'react';
import { toUiError } from '@/chain/errors';
import { useSeason } from '@/game';
import type { Mode } from '@/game/types';
import { Heron } from '@/mascot/Heron';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { RadioChips } from '@/ui/Chip';
import { InkBox } from '@/ui/InkBox';
import { ModePicker } from './shared/ModePicker';
import { PageHead } from './shared/PageHead';

const cell = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

/** S7: ledger-style boards. When the deployment has no season view, an honest asleep state. */
export function SeasonPage() {
  const [mode, setMode] = useState<Mode>(0);
  const [season, setSeason] = useState(0);
  const q = useSeason(mode, season);
  const rows = q.data && q.data.supported ? (q.data.rows as Record<string, unknown>[]) : [];
  const cols = rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];

  return (
    <div className="wrap pb-20 pt-8 md:pt-12">
      <PageHead
        title={
          <>
            The season <span className="text-grape">board</span>
          </>
        }
        kicker="seven rounds, one board"
        note="rounds won, shares, earnings"
        underline="doodles/underline-grape"
        art="heron/vest"
        artWidth={110}
      />
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <ModePicker mode={mode} onChange={setMode} />
        <RadioChips
          label="Season"
          value={season}
          onChange={setSeason}
          small
          options={[0, 1, 2].map(s => ({ value: s, label: `Season ${s}` }))}
        />
      </div>
      <div className="mt-8" aria-live="polite">
        {q.isLoading ? (
          <p className="display text-[36px]" aria-busy="true">
            Reading the board…
          </p>
        ) : q.isError ? (
          <ErrorCard error={toUiError(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data && !q.data.supported ? (
          <EmptyState title="This deployment keeps no season board" art="stickers/asleep" artWidth={170}>
            The rehearsal contracts do not expose a season view, so there is nothing honest to rank. Every
            round&apos;s plays are still public on the ledger.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="Nobody on the board yet" art="drip/asleep" artWidth={170}>
            No finished rounds in this season for the {mode === 0 ? 'Solo' : 'Team'} board.
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
      <div className="mt-10 hidden justify-end sm:flex">
        <Heron pose="suit" width={90} />
      </div>
    </div>
  );
}
