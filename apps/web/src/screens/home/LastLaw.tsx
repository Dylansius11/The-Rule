import { shortHash } from '@/chain/format';
import { useLatestRevealedRound } from '@/game';
import { Art } from '@/art/Art';
import { Blot } from '@/mascot/Blot';
import { useRuleText } from '@/verify';
import { Button } from '@/ui/Button';
import { Doodle } from '@/ui/Doodle';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { modeName, outcomeLabel } from '../shared/round';
import { toUiError } from '@/chain/errors';

/** "The last law, opened": the newest revealed round from the chain, with the way to replay every verdict. */
export function LastLaw() {
  const q = useLatestRevealedRound();
  const round = q.data ?? null;
  const text = useRuleText(round?.rule ?? null);

  return (
    <div
      className="wrap relative grid items-center gap-8 py-12 md:grid-cols-[1.1fr_0.9fr] md:gap-12 md:py-20"
      id="last-law"
    >
      <InkBox className="p-6 text-ink md:p-9" tilt={-2} fill="var(--color-paper)" aria-live="polite">
        <h2 className="display text-[clamp(44px,7vw,64px)] leading-[0.9]">The last law, opened</h2>
        {q.isLoading ? (
          <p className="mt-4 font-bold" aria-busy="true">
            Reading the newest revealed round from the chain…
          </p>
        ) : q.isError ? (
          <div className="mt-4">
            <ErrorCard error={toUiError(q.error)} onRetry={() => void q.refetch()} />
          </div>
        ) : round ? (
          <>
            <p className="mono mt-3 text-[14px] font-bold">
              {modeName(round.mode)} round {round.roundId} · {outcomeLabel(round)} · commit{' '}
              {round.commit ? shortHash(round.commit) : '–'}
            </p>
            <p className="mt-4 text-[13px] font-extrabold uppercase tracking-widest text-ink-soft">
              The rule was
            </p>
            <p className="mt-1 text-[clamp(24px,3.4vw,32px)] font-extrabold leading-tight">
              {text ? (
                <span className="hl">{text.english}</span>
              ) : (
                <span aria-busy="true">Reading the rule…</span>
              )}
            </p>
            <dl className="mono mt-5 grid grid-cols-2 gap-3 text-[14px] font-bold">
              <div>
                <dt className="text-ink-soft">plays</dt>
                <dd className="text-[22px]">{round.logLen.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">winner</dt>
                <dd className="break-all text-[16px]">
                  {round.outcome?.kind === 'Solved' ? round.outcome.account : 'no winner'}
                </dd>
              </div>
            </dl>
            <div className="mt-6">
              <Button to={`/reveal?mode=${round.mode}&round=${round.roundId}`} variant="red" size="lg">
                Replay every verdict
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 text-[19px] font-bold">
              No law has opened yet. The first reveal lands here, with every verdict replayable in your
              browser.
            </p>
            <div className="mt-4">
              <Art name="stickers/asleep" width={120} />
            </div>
          </>
        )}
      </InkBox>
      <div className="relative mx-auto w-[min(260px,60vw)]">
        <Blot state="reveal" width="100%" />
        <Doodle name="doodles/key" size={54} x={-12} y={60} rot={-18} float />
        <Doodle name="doodles/sparkle" size={44} x={86} y={4} rot={12} twinkle />
      </div>
    </div>
  );
}
