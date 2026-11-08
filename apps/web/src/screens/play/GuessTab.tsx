import { useState } from 'react';
import { toUiError } from '@/chain/errors';
import { useCommits, useGuessActions, useLog, useParams, usePlayer, useWallet } from '@/game';
import type { Mode, Round } from '@/game/types';
import { roomPath } from '@/app/paths';
import { useGuide } from '@/layout/guide';
import { PageHead } from '@/screens/shared/PageHead';
import { isPlayable, modeName, phaseLabel } from '@/screens/shared/round';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { CommitStep } from './guess/CommitStep';
import { HypothesisStep } from './guess/HypothesisStep';
import { RevealStep } from './guess/RevealStep';
import { StepNav, type GuessStep } from './guess/StepNav';
import { TestStep } from './guess/TestStep';
import { useGuessDraft } from './guess/useGuessDraft';
import { useRoom } from './room';

const STEPS: readonly GuessStep[] = [
  { title: 'Write', note: 'what is your hunch?' },
  { title: 'Test', note: 'free, nothing is sent' },
  { title: 'Commit', note: 'seal it with a stake' },
  { title: 'Reveal', note: 'then open it' },
];

const HEADINGS = [
  'Write your hypothesis',
  'Test it free against the ledger',
  'Commit your guess',
  'Reveal it',
];

function stakeFor(round: Round, mode: Mode, bps: [number, number], min: bigint) {
  const pct = (round.pot * BigInt(bps[mode])) / 10_000n;
  return pct < min ? min : pct;
}

/** The guess tab: four steps from a hunch to a revealed commit. The newest round of the room's mode is the one guessed on. */
export function GuessTab() {
  const { mode, latest } = useRoom();
  const round = latest.data ?? null;
  const params = useParams();
  const { status, accountId } = useWallet();
  const player = usePlayer(accountId);
  const log = useLog(mode, round?.roundId ?? null);
  const commits = useCommits(mode, round?.roundId ?? null);
  const actions = useGuessActions(mode, round?.roundId ?? 0);
  const draft = useGuessDraft(log);
  const { show } = useGuide();
  const [step, setStep] = useState(0);

  const open = isPlayable(round);
  const stake =
    round && params.data ? stakeFor(round, mode, params.data.stakeBps, params.data.stakeMin) : null;
  const needsTeam =
    mode === 1 && status === 'connected' && player.isSuccess && (player.data?.teamId ?? null) === null;
  const reachable = (i: number) => i === 0 || i === 3 || draft.rule !== null;
  const last = step === STEPS.length - 1;

  return (
    <div className="wrap pb-20 pt-7 md:pt-10">
      <PageHead
        title={
          <>
            Make your <span className="text-tomato">guess</span>
          </>
        }
        kicker="seal it, then open it"
        note="a guess is a hash until you reveal it."
        art="scenes/envelope"
        artWidth={150}
      />

      {latest.isError ? (
        <div className="mt-6">
          <ErrorCard error={toUiError(latest.error)} onRetry={() => void latest.refetch()} />
        </div>
      ) : null}

      {!open && !latest.isLoading ? (
        <div className="mt-8">
          <EmptyState
            title="No round is taking guesses"
            art="stickers/envelope"
            artWidth={130}
            actions={
              <Button to={roomPath(mode, 'verify')} variant="red">
                See the last opened law
              </Button>
            }
          >
            {round
              ? `${modeName(mode)} round ${round.roundId} is ${phaseLabel(round.phase).toLowerCase()}. `
              : `No ${modeName(mode).toLowerCase()} round has started. `}
            Guesses can be sealed only while plays are open. You can still write one and test it for free.
          </EmptyState>
        </div>
      ) : null}

      <InkBox className="mx-auto mt-8 max-w-[920px] p-5 md:p-8" fill="#fff" tilt={-0.3}>
        <StepNav steps={STEPS} current={step} reachable={reachable} onGo={setStep} />
        <div className="mt-6">
          <span className="hand -rotate-1 block text-[24px] leading-none text-tomato-deep">
            step {step + 1} of {STEPS.length} · {STEPS[step]!.note}
          </span>
          <h2 className="display mt-1 text-[clamp(34px,6vw,52px)] leading-[0.92]">{HEADINGS[step]}</h2>
        </div>
        <div className="mt-4">
          {step === 0 ? <HypothesisStep draft={draft} /> : null}
          {step === 1 ? <TestStep draft={draft} log={log} /> : null}
          {step === 2 ? (
            <CommitStep draft={draft} actions={actions} open={open} stake={stake} needsTeam={needsTeam} />
          ) : null}
          {step === 3 ? (
            <RevealStep actions={actions} commits={commits} round={round} account={accountId} />
          ) : null}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3 border-t-[3px] border-dashed border-ink/40 pt-5">
          <Button variant="paper" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          {last ? null : (
            <Button
              variant={step === 2 ? 'paper' : 'red'}
              size="sm"
              disabled={!reachable(step + 1)}
              onClick={() => setStep(step + 1)}
            >
              {step === 2 ? 'Skip to reveal' : 'Next'}
            </Button>
          )}
        </div>
      </InkBox>

      <p className="mx-auto mt-5 max-w-[920px] text-[14px] font-semibold text-ink-soft">
        New to this?{' '}
        <button
          type="button"
          onClick={show}
          className="min-h-[44px] font-extrabold underline decoration-2 underline-offset-2"
        >
          How to play
        </button>
        . Commit order decides ties: the earliest correct commit wins.
      </p>
    </div>
  );
}
