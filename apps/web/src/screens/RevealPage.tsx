import { useEffect, useRef, useState } from 'react';
import { toUiError } from '@/chain/errors';
import { useLog, useParams, useRound } from '@/game';
import type { ReplayState } from '@/game/types';
import { REPLAY_LIMIT } from '@/config/env';
import { Art } from '@/art/Art';
import { Blot, type BlotState } from '@/mascot/Blot';
import { useTypewriter } from '@/motion/hooks';
import { useReduced } from '@/motion/prefs';
import { useReplay, useRuleText } from '@/verify';
import { Band } from '@/ui/Band';
import { Button } from '@/ui/Button';
import { RadioChips } from '@/ui/Chip';
import { Doodle, StarField } from '@/ui/Doodle';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { HashText } from '@/ui/HashText';
import { InkBox } from '@/ui/InkBox';
import { LiveRegion } from '@/ui/LiveRegion';
import { Tag } from '@/ui/Tag';
import { ModePicker } from './shared/ModePicker';
import { downloadLog } from './shared/exportLog';
import { modeName, outcomeLabel, phaseLabel } from './shared/round';
import { useRoundParam } from './shared/useRoundParam';
import { Check, type CheckTone } from './reveal/Check';
import { Payouts } from './reveal/Payouts';

function replaySummary(state: ReplayState): string {
  if (state.kind === 'done') {
    const r = state.result;
    return r.pass
      ? `Replay passed. ${r.matched} of ${r.total} verdicts match the revealed rule. The commitment matches.`
      : `Replay failed. ${r.firstFailure ?? 'A check did not match.'}`;
  }
  if (state.kind === 'error') return `Replay stopped. ${state.error.title}`;
  return '';
}

/** S4: the seal cracks, the rule types out, the browser replays every verdict. */
export function RevealPage() {
  const sel = useRoundParam('revealed');
  const roundQ = useRound(sel.mode, sel.roundId);
  const round = roundQ.data ?? null;
  const log = useLog(sel.mode, round?.rule ? sel.roundId : null);
  const params = useParams();
  const reduced = useReduced();
  const text = useRuleText(round?.rule ?? null);
  const replay = useReplay(round?.rule ? round : null);
  const [opened, setOpened] = useState(false);
  const started = useRef(false);

  // Switching round resets the ceremony.
  useEffect(() => {
    setOpened(false);
    started.current = false;
  }, [sel.mode, sel.roundId]);

  const typed = useTypewriter(text?.english ?? '', opened && !!text, reduced);
  const typedDone = !!text && typed.length >= text.english.length && opened;
  useEffect(() => {
    if (typedDone && !started.current) {
      started.current = true;
      replay.run();
    }
  }, [typedDone, replay]);

  const state = replay.state;
  const blot: BlotState = !opened
    ? 'reveal'
    : state.kind === 'done'
      ? state.result.pass
        ? 'yes'
        : 'no'
      : state.kind === 'error'
        ? 'no'
        : 'pending';
  const revealedRounds = sel.rounds;
  const verifyCmd = `make verify ROUND=${modeName(sel.mode).toLowerCase()}/${sel.roundId ?? 0}`;

  const matchTone: CheckTone = !opened
    ? 'wait'
    : state.kind === 'done'
      ? state.result.matched === state.result.total && state.result.pass
        ? 'ok'
        : 'bad'
      : state.kind === 'error'
        ? 'bad'
        : 'run';
  const commitTone: CheckTone = !opened
    ? 'wait'
    : state.kind === 'done'
      ? state.result.commitmentOk
        ? 'ok'
        : 'bad'
      : state.kind === 'error'
        ? 'bad'
        : 'run';
  const completeTone: CheckTone = !opened
    ? 'wait'
    : state.kind === 'done'
      ? state.result.logComplete
        ? 'ok'
        : 'bad'
      : state.kind === 'error'
        ? 'bad'
        : 'run';

  return (
    <>
      <div className="wrap pb-12 pt-8 md:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="hand mb-1 block -rotate-2 text-[26px]">the seal cracks</span>
            <h1 className="display text-[clamp(52px,9vw,104px)] leading-[0.85]">
              Reveal <span className="text-tomato">&amp;</span> verify
            </h1>
            <Doodle name="doodles/magnifier" size={56} className="ml-1 mt-2" float />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <ModePicker mode={sel.mode} onChange={sel.setMode} />
          {revealedRounds.length > 0 ? (
            <RadioChips
              label="Round"
              value={sel.roundId}
              onChange={sel.setRound}
              small
              options={revealedRounds.slice(0, 10).map(id => ({ value: id, label: `#${id}` }))}
            />
          ) : null}
          {round ? (
            <Tag tone={round.rule ? 'yes' : 'soft'}>
              {round.rule ? '✓ Rule public' : phaseLabel(round.phase)}
            </Tag>
          ) : null}
        </div>
      </div>

      {sel.loading || roundQ.isLoading ? (
        <div className="wrap pb-20" aria-busy="true">
          <p className="display text-[40px]">Opening the file…</p>
        </div>
      ) : roundQ.isError ? (
        <div className="wrap pb-20">
          <ErrorCard error={toUiError(roundQ.error)} onRetry={() => void roundQ.refetch()} />
        </div>
      ) : !round ? (
        <div className="wrap pb-20">
          <EmptyState title="No such round" art="stickers/asleep">
            This deployment has no {modeName(sel.mode).toLowerCase()} round {sel.roundId ?? ''}. Pick another
            from the round chips.
          </EmptyState>
        </div>
      ) : !round.rule || !round.salt || !round.commit ? (
        <div className="wrap pb-20">
          <EmptyState title="Still sealed" art="stickers/hiding" artWidth={170}>
            {modeName(sel.mode)} round {round.roundId} is {phaseLabel(round.phase).toLowerCase()}. The rule
            opens only at the reveal, and this page has nothing to show before that.
            {sel.revealed.data ? (
              <>
                {' '}
                The newest opened law is {modeName(sel.revealed.data.mode)} round {sel.revealed.data.roundId}.
              </>
            ) : null}
          </EmptyState>
          {sel.revealed.data &&
          (sel.revealed.data.roundId !== round.roundId || sel.revealed.data.mode !== round.mode) ? (
            <div className="mt-5 text-center">
              <Button
                to={`/reveal?mode=${sel.revealed.data.mode}&round=${sel.revealed.data.roundId}`}
                variant="red"
              >
                Open the newest revealed round
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <Band tone="ink" seed={7} amp={14} className="pb-24 pt-16 md:pt-20">
          <StarField
            spots={[
              { x: 4, y: 10, s: 46, r: 0 },
              { x: 90, y: 6, s: 56, r: 12 },
              { x: 50, y: 92, s: 40, r: -8 },
              { x: 96, y: 60, s: 32, r: 0 },
            ]}
          />
          <LiveRegion message={replaySummary(state)} assertive={state.kind === 'error'} />
          <div className="wrap relative grid items-start gap-10 lg:grid-cols-[1.15fr_0.85fr]">
            <InkBox className="p-6 text-ink md:p-9" tilt={-1.6} fill="var(--color-paper)">
              <h2 className="display text-[clamp(44px,6vw,64px)] leading-[0.9]">The rule was…</h2>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] font-bold">
                <span className="mono">commit</span>
                <HashText value={round.commit} full label="commitment" />
              </p>

              <div className="mt-4 min-h-[96px]" aria-live="polite">
                {opened ? (
                  <p
                    className={`text-[clamp(26px,3.6vw,34px)] font-extrabold leading-tight ${typedDone ? '' : 'caret'}`}
                  >
                    <span className={typedDone ? 'hl' : ''}>{typed || '\u00A0'}</span>
                  </p>
                ) : (
                  <p className="hand text-[28px] text-ink-soft">(sealed, until you break it)</p>
                )}
              </div>

              {opened && typedDone && text ? (
                <div className="mt-3 grid gap-3">
                  <div>
                    <div className="mono text-[12px] font-bold uppercase tracking-widest text-ink-soft">
                      Rule DSL
                    </div>
                    <code className="mono block break-words rounded bg-paper-2 p-2 text-[14px] font-bold">
                      {text.dsl}
                    </code>
                  </div>
                  <div>
                    <div className="mono text-[12px] font-bold uppercase tracking-widest text-ink-soft">
                      Canonical JSON
                    </div>
                    <code className="mono block break-all rounded bg-paper-2 p-2 text-[14px] font-bold">
                      {text.json}
                    </code>
                  </div>
                  <div>
                    <div className="mono text-[12px] font-bold uppercase tracking-widest text-ink-soft">
                      Salt
                    </div>
                    <HashText value={round.salt} full label="salt" />
                  </div>
                </div>
              ) : null}

              <ul className="mt-6 grid gap-3" aria-label="Checks">
                <Check
                  tone={commitTone}
                  detail={
                    opened && state.kind === 'done'
                      ? 'sha256(canonical rule + salt) equals the commitment published at round start.'
                      : undefined
                  }
                >
                  Day-1 commitment{' '}
                  {state.kind === 'done'
                    ? state.result.commitmentOk
                      ? 'matches'
                      : 'does NOT match'
                    : 'check'}
                </Check>
                <Check
                  tone={matchTone}
                  detail={
                    state.kind === 'loading'
                      ? `Loading the log: ${state.loaded} of ${state.total} rows`
                      : state.kind === 'running'
                        ? 'Replaying inside a Web Worker'
                        : state.kind === 'done'
                          ? `${(state.elapsedMs / 1000).toFixed(1)} s in your browser`
                          : undefined
                  }
                >
                  {state.kind === 'done'
                    ? `${state.result.matched} of ${state.result.total} verdicts match`
                    : `Replaying ${round.logLen} verdicts in your browser`}
                </Check>
                <Check tone={completeTone}>
                  {state.kind === 'done' && !state.result.logComplete
                    ? 'The log is incomplete'
                    : 'Log is complete'}
                </Check>
                <Check tone="info" detail={params.data ? undefined : 'loading…'}>
                  Pinned referee hash{' '}
                  {params.data ? (
                    <HashText value={params.data.refereeHash} full label="referee hash" />
                  ) : null}
                  <span className="mt-1 block text-[13px] font-semibold text-ink-soft">
                    Published on chain. Not checked in the browser: compare it with the reproducible build.
                  </span>
                </Check>
              </ul>

              {state.kind === 'done' && !state.result.pass ? (
                <p className="mt-4 rounded bg-tomato p-3 font-extrabold" role="alert">
                  Replay failed: {state.result.firstFailure ?? 'a check did not match.'}
                </p>
              ) : null}
              {state.kind === 'error' ? (
                <div className="mt-4">
                  <ErrorCard error={state.error} onRetry={() => replay.run()} />
                </div>
              ) : null}
              {opened ? <p className="mt-4 text-[14px] font-semibold text-ink-soft">{REPLAY_LIMIT}</p> : null}
            </InkBox>

            <div className="text-paper">
              <h2 className="display text-[clamp(52px,7vw,92px)] leading-[0.88]">
                Break the <span className="text-sun">seal.</span>
              </h2>
              <p className="mt-4 max-w-[30ch] text-[22px] font-bold leading-snug">
                The rule is public now. Your browser replays every verdict against it and against the
                commitment from day one.
              </p>
              <div className="relative mt-6 flex flex-wrap gap-4">
                <Doodle
                  name="doodles/arrow-loop"
                  size={96}
                  x={-24}
                  y={-70}
                  rot={8}
                  className="hidden xl:block"
                />
                <Button
                  variant="red"
                  size="lg"
                  onClick={() => setOpened(true)}
                  disabled={opened}
                  busy={opened && !typedDone}
                >
                  {opened ? (state.kind === 'done' ? 'Seal broken' : 'Breaking…') : 'Break the seal'}
                </Button>
                {opened && (state.kind === 'done' || state.kind === 'error') ? (
                  <Button variant="paper" onClick={() => replay.run()}>
                    Replay again
                  </Button>
                ) : null}
              </div>
              <div className="relative mt-6 w-[min(210px,50vw)]">
                <Blot state={blot} width="100%" pulse={blot} burst={blot === 'yes' ? 'pass' : null} />
              </div>
            </div>
          </div>

          <div className="wrap relative mt-12 grid gap-8 text-ink lg:grid-cols-2">
            <InkBox className="p-6" fill="var(--color-paper)" tilt={0.6}>
              <h2 className="display flex items-center gap-2 text-[36px]">
                Winner &amp; payouts <Doodle name="doodles/ribbon" size={60} rot={-4} />
              </h2>
              <p className="mono mt-1 text-[14px] font-bold">
                {modeName(round.mode)} round {round.roundId} · {outcomeLabel(round)}
              </p>
              <div className="mt-3">
                <Payouts round={round} />
              </div>
            </InkBox>
            <InkBox className="p-6" fill="var(--color-paper)" tilt={-0.6}>
              <h2 className="display text-[36px]">Check it outside this page</h2>
              <p className="mt-1 font-semibold">The same replay runs in a terminal:</p>
              <div className="mt-2">
                <HashText value={verifyCmd} full label="verify command" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  variant="paper"
                  size="sm"
                  disabled={!log.complete}
                  onClick={() =>
                    downloadLog(
                      log.rows,
                      `rule-${modeName(round.mode).toLowerCase()}-round-${round.roundId}-log`,
                      'json',
                    )
                  }
                >
                  Download log JSON
                </Button>
                <Button
                  variant="paper"
                  size="sm"
                  disabled={!log.complete}
                  onClick={() =>
                    downloadLog(
                      log.rows,
                      `rule-${modeName(round.mode).toLowerCase()}-round-${round.roundId}-log`,
                      'csv',
                    )
                  }
                >
                  Download log CSV
                </Button>
                {!log.complete ? (
                  <span className="text-[14px] font-bold">
                    Loading the full log first ({log.loaded} of {log.total}).
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex items-end gap-3">
                <Art name="doodles/key" width={44} />
                <p className="text-[15px] font-semibold">
                  Salt and rule are the ones the contract stored at the reveal.
                </p>
              </div>
            </InkBox>
          </div>
        </Band>
      )}
    </>
  );
}
