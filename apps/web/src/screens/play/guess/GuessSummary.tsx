import type { ReactNode } from 'react';
import { useParams } from '@/game';
import { guessCost } from '@/game/cost';
import type { Mode, Round } from '@/game/types';
import { Blot } from '@/mascot/Blot';
import { Amount } from '@/ui/Amount';
import { InkBox } from '@/ui/InkBox';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { CostPayout } from '../CostPayout';
import { summaryState } from './summaryState';
import type { GuessDraft } from './useGuessDraft';

interface GuessSummaryProps {
  draft: GuessDraft;
  mode: Mode;
  round: Round | null;
  /** A commit is being signed or is waiting for the chain. */
  committing: boolean;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t-2 border-dashed border-ink/40 py-2.5 first:border-t-0 first:pt-0">
      <dt className="mono text-[12px] font-bold uppercase tracking-widest text-ink-soft">{label}</dt>
      <dd className="mt-0.5 break-words text-[16px] font-bold leading-snug">{children}</dd>
    </div>
  );
}

/** The sticky left column of the wide guess page: the guess so far, its free check and what committing costs. */
export function GuessSummary({ draft, mode, round, committing }: GuessSummaryProps) {
  const params = useParams();
  const { rule, text, preview, form, catalog, check } = draft;
  const state = summaryState(rule !== null, check, committing);
  const shape = catalog.forms.find(f => f.id === form)?.name ?? ['Single', 'AND', 'OR'][form] ?? '';
  const words = text ? text.english : preview.filter(Boolean).join(form === 1 ? ' and ' : ' or ');
  const cost = params.data ? guessCost(params.data, mode, round ? round.pot : null) : null;

  return (
    <aside aria-label="Your guess" className="sticky" style={{ top: 'calc(var(--header-h) + 72px)' }}>
      <InkBox fill="#fff">
        <div className="max-h-[calc(100svh-var(--header-h)-96px)] overflow-y-auto p-5">
          <h2 className="display text-[34px] leading-none">Your guess</h2>
          <div className="mt-3 flex items-end gap-3">
            <div className="w-[96px] flex-none">
              <Blot state={state.pose} width="100%" pulse={state.pose} />
            </div>
            <div className="mb-3 min-w-0 flex-1">
              <SpeechBubble id={state.line}>
                <span className="block text-[22px]">{state.line}</span>
              </SpeechBubble>
            </div>
          </div>
          <dl className="mt-4">
            <Row label="Rule shape">{shape}</Row>
            <Row label="Your guess in words">
              {words ? words : <span className="font-semibold text-ink-soft">Not written yet.</span>}
            </Row>
            <Row label="Free check">
              <span aria-live="polite" className={state.disagrees ? 'text-tomato-deep' : undefined}>
                {state.disagrees ? <span aria-hidden="true">✗ </span> : null}
                {state.status}
              </span>
            </Row>
            <Row label="Committing costs">
              {cost ? (
                <>
                  <Amount kind="near" value={cost.stake} digits={5} /> stake +{' '}
                  <Amount kind="near" value={cost.storage} digits={5} /> storage ={' '}
                  <Amount kind="near" value={cost.total} digits={5} />
                  <span className="mt-0.5 block text-[14px] font-semibold text-ink-soft">
                    {cost.potKnown ? 'At the current pot. ' : 'At the minimum stake. '}
                    The storage charge is never returned.
                  </span>
                </>
              ) : params.isError ? (
                <span className="font-semibold text-tomato-deep">
                  Could not read the costs. Open Cost &amp; payout below to retry.
                </span>
              ) : (
                <span className="font-semibold text-ink-soft">Reading the costs from the contract…</span>
              )}
            </Row>
          </dl>
          <CostPayout mode={mode} round={round} className="mt-4" />
        </div>
      </InkBox>
    </aside>
  );
}
