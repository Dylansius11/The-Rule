import type { ReactNode } from 'react';
import { toUiError } from '@/chain/errors';
import { useParams } from '@/game';
import {
  bpsPercent,
  feeSplitRows,
  guessCost,
  playCost,
  potSplitRows,
  wrongGuess,
  type SplitRow,
} from '@/game/cost';
import { nameTiers } from '@/game/tiers';
import type { Mode, Params, Round } from '@/game/types';
import { modeName } from '@/screens/shared/round';
import { Amount } from '@/ui/Amount';
import { Button } from '@/ui/Button';
import { Term } from '@/ui/Term';

interface CostPayoutProps {
  mode: Mode;
  /** The room's newest round. Its pot, when present, turns stakes and shares into amounts. */
  round: Round | null;
  defaultOpen?: boolean;
  className?: string;
}

const near = (value: bigint) => <Amount kind="near" value={value} digits={5} />;

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="display text-[26px] leading-none">{title}</h3>
      <div className="mt-2 grid gap-1.5 text-[16px] font-semibold">{children}</div>
    </section>
  );
}

function Line({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 ${strong ? 'border-t-2 border-dashed border-ink/40 pt-1.5 font-extrabold' : ''}`}
    >
      <span className="min-w-0">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Split({ rows }: { rows: SplitRow[] }) {
  return (
    <>
      {rows.map(r => (
        <Line key={r.label} label={r.label}>
          <b className="mono">{r.percent}</b>
          {r.amount === null ? null : (
            <>
              {' '}
              <span className="text-ink-soft">·</span> {near(r.amount)}
            </>
          )}
        </Line>
      ))}
    </>
  );
}

function Body({ params, mode, round }: { params: Params; mode: Mode; round: Round | null }) {
  const pot = round ? round.pot : null;
  const play = playCost(params);
  const guess = guessCost(params, mode, pot);
  const wrong = wrongGuess(guess.stake, params.wrongReturnBps);
  const tiers = nameTiers(params.lockTiers);
  const who = modeName(mode);
  const shares = params.shareCap[mode];
  return (
    <div>
      <p className="text-[15px] font-bold text-ink-soft">
        Read live from the game contract, for {who} rooms. These numbers are fixed at deployment.
      </p>

      <div className="mt-4">
        <Sub title="One play">
          <Line label="Play fee">{near(play.fee)}</Line>
          <Line label="Storage charge">{near(play.storage)}</Line>
          <Line label="You pay" strong>
            {near(play.total)}
          </Line>
          <p className="text-[15px] font-bold text-ink-soft">
            The storage charge pays for the chain space your play uses. It is not pot money and is never
            returned. Repeating a combination you already tried in the same context is free.
          </p>
        </Sub>

        <Sub title="One guess">
          <Line label={guess.potKnown ? 'Stake at the current pot' : 'Stake (at least)'}>
            {near(guess.stake)}
          </Line>
          <Line label="Storage charge, never returned">{near(guess.storage)}</Line>
          <Line label="You pay" strong>
            {near(guess.total)}
          </Line>
          <p className="text-[15px] font-bold text-ink-soft">
            The <Term term="stake" /> is the larger of {near(params.stakeMin)} and {bpsPercent(guess.bps)} of
            the pot
            {round ? (
              <>
                {' '}
                (round {round.roundId} pot: {near(round.pot)})
              </>
            ) : null}
            . It is locked when you <Term term="commit" />.
          </p>
        </Sub>

        <Sub title="If your guess is wrong">
          <Line label="Correct guess">stake back in full</Line>
          <Line label={`Wrong or never revealed (${bpsPercent(params.wrongReturnBps)} back)`}>
            {near(wrong.back)} back · {near(wrong.toPot)} to the pot
          </Line>
          <p className="text-[15px] font-bold text-ink-soft">
            If the system fails to check your guess, your whole stake comes back. A wrong guess gets no hint.
          </p>
        </Sub>

        <Sub title="Where a play fee goes">
          <Split rows={feeSplitRows(params)} />
        </Sub>

        <Sub title="How the pot is split">
          <p className="font-extrabold">
            {pot === null ? 'If the round is solved' : 'If solved, at this pot'}
          </p>
          <Split rows={potSplitRows(true, params, pot)} />
          <p className="mt-2 font-extrabold">
            {pot === null ? 'If nobody solves it' : 'If unsolved, at this pot'}
          </p>
          <Split rows={potSplitRows(false, params, pot)} />
          <p className="text-[15px] font-bold text-ink-soft">
            The winner is the earliest correct commit. Contributors get one <Term term="contributor share" />{' '}
            per unique paid play, up to {shares} per round for {who}. The pot can still change while the round
            is open.
          </p>
        </Sub>

        <Sub title="Attempts and locks">
          <Line label={<Term term="attempt">Attempts</Term>}>
            {params.baseAttempts[mode]} per round · hard cap {params.attemptCap[mode]}
          </Line>
          {tiers.map(t => (
            <Line key={t.index} label={`${t.name} lock`}>
              <Amount kind="rule" value={t.amount} /> <span className="text-ink-soft">→</span> +
              {t.extraAttempts} attempts
            </Line>
          ))}
          <p className="text-[15px] font-bold text-ink-soft">
            Locking RULE before a round adds attempts. Extra attempts still pay the play fee, each lock pays
            the storage charge, and locked RULE is returned after the round.
          </p>
        </Sub>
      </div>
    </div>
  );
}

/** A collapsible "Cost & payout" panel: every number is read from the contract's parameters, never typed in. */
export function CostPayout({ mode, round, defaultOpen = false, className = '' }: CostPayoutProps) {
  const params = useParams();
  return (
    <details
      className={`group rounded-lg border-[3px] border-ink bg-white ${className}`}
      open={defaultOpen || undefined}
    >
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="display text-[26px] leading-none">Cost &amp; payout</span>
        <span
          aria-hidden="true"
          className="mono text-[22px] font-bold transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className="border-t-[3px] border-dashed border-ink/40 p-4" aria-busy={params.isLoading}>
        {params.data ? (
          <Body params={params.data} mode={mode} round={round} />
        ) : params.isError ? (
          <div role="alert">
            <p className="mb-2 font-extrabold">
              The contract&apos;s parameters could not be read, so no costs are shown.
            </p>
            <Button variant="paper" size="sm" onClick={() => void params.refetch()}>
              Try again
            </Button>
            <p className="mt-2 text-[14px] font-bold text-ink-soft">{toUiError(params.error).title}</p>
          </div>
        ) : (
          <p className="font-bold">Reading the parameters from the contract…</p>
        )}
      </div>
    </details>
  );
}
