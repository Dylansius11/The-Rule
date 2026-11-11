import { useEffect, useRef, useState } from 'react';
import { toUiError } from '@/chain/errors';
import { roomPath } from '@/app/paths';
import { useSound } from '@/audio';
import { useLog, useParams, useRound, useWallet } from '@/game';
import type { ReplayState } from '@/game/types';
import { REPLAY_LIMIT } from '@/config/env';
import { Art } from '@/art/Art';
import { Blot, type BlotState } from '@/mascot/Blot';
import { useTypewriter } from '@/motion/hooks';
import { useReduced } from '@/motion/prefs';
import { useReplay, useRuleText } from '@/verify';
import { Band } from '@/ui/Band';
import { Button } from '@/ui/Button';
import { Doodle, StarField } from '@/ui/Doodle';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { HashText } from '@/ui/HashText';
import { InkBox } from '@/ui/InkBox';
import { LiveRegion } from '@/ui/LiveRegion';
import { Tag } from '@/ui/Tag';
import { RoundPicker } from '@/screens/shared/RoundPicker';
import { downloadLog } from '@/screens/shared/exportLog';
import { modeName, outcomeLabel, phaseLabel } from '@/screens/shared/round';
import { useRoundSelection } from '@/screens/shared/useRoundSelection';
import { RoundHistoryNotice } from '@/screens/shared/RoundHistoryNotice';
import { useRoom } from './room';
import { Check, type CheckTone } from './verify/Check';
import { Payouts } from './verify/Payouts';
import { WinnerBanner } from './verify/WinnerBanner';

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
export function VerifyTab() {
  const { mode } = useRoom();
  const sel = useRoundSelection(mode, 'revealed');
  const roundQ = useRound(mode, sel.roundId);
  const round = roundQ.data ?? null;
  const log = useLog(mode, round?.rule ? sel.roundId : null);
  const params = useParams();
  const { accountId } = useWallet();
  const reduced = useReduced();
  const sound = useSound();
  const text = useRuleText(round?.rule ?? null);
  const replay = useReplay(round?.rule ? round : null);
  const [opened, setOpened] = useState(false);
  const started = useRef(false);

  // Switching round or mode resets the ceremony.
  useEffect(() => {
    setOpened(false);
    started.current = false;
  }, [mode, sel.roundId]);

  // The replay finishing is the player's own result, so it earns a sound.
  const replayKind = replay.state.kind;
  const replayPass = replay.state.kind === 'done' && replay.state.result.pass;
  useEffect(() => {
    if (replayKind === 'done') sound.play(replayPass ? 'replay-pass' : 'replay-fail');
    if (replayKind === 'error') sound.play('replay-fail');
  }, [replayKind, replayPass, sound]);

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
  const verifyCmd = `make verify ROUND=${modeName(mode).toLowerCase()}/${sel.roundId ?? 0}`;

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
      <div
        className={`wrap pt-7 md:pt-10 ${round?.rule && round.salt && round.commit ? 'pb-28 md:pb-32' : 'pb-6'}`}
      >
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <span className="hand mb-1 block -rotate-2 text-[26px] leading-none">the seal cracks</span>
            <h1 className="display flex flex-wrap items-center gap-x-3 text-[clamp(48px,7.5vw,88px)] leading-[0.85]">
              <span>
                Reveal <span className="text-tomato">&amp;</span> verify
              </span>
              <Doodle name="doodles/magnifier" size={56} rot={-6} float className="shrink-0 max-sm:hidden" />
            </h1>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <RoundPicker rounds={sel.rounds} value={sel.roundId} onChange={sel.setRound} />
          {round ? (
            <Tag tone={round.rule ? 'yes' : 'soft'}>
              {round.rule ? '✓ Rule public' : phaseLabel(round.phase)}
            </Tag>
          ) : null}
        </div>
        <RoundHistoryNotice history={sel.history} />
      </div>

      {sel.loading || roundQ.isLoading ? (
        <div className="wrap pb-20" aria-busy="true">
          <p className="display text-[40px]">Opening the file…</p>
        </div>
      ) : roundQ.isError ? (
        <div className="wrap pb-20">
          <ErrorCard error={toUiError(roundQ.error)} onRetry={() => void roundQ.refetch()} />
        </div>
      ) : !round && sel.history.error ? (
        <div className="wrap pb-20">
          <p className="font-bold">Round discovery is incomplete. Retry the failed reads above.</p>
        </div>
      ) : !round ? (
        <div className="wrap pb-20">
          <EmptyState title="No such round" art="stickers/asleep">
            This deployment has no {modeName(mode).toLowerCase()} round {sel.roundId ?? ''}. Pick another from
            the round chips.
          </EmptyState>
        </div>
      ) : !round.rule || !round.salt || !round.commit ? (
        <div className="wrap pb-20">
          <EmptyState title="Still sealed" art="stickers/hiding" artWidth={170}>
            {modeName(mode)} round {round.roundId} is {phaseLabel(round.phase).toLowerCase()}. The rule opens
            only at the reveal, and this page has nothing to show before that.
            {sel.revealed ? (
              <>
                {' '}
                The newest opened {modeName(mode)} law found in recent lookups is round {sel.revealed.roundId}
                .
              </>
            ) : (
              <> No opened {modeName(mode)} law was found in the bounded lookup window.</>
            )}
          </EmptyState>
          {sel.revealed && sel.revealed.roundId !== round.roundId ? (
            <div className="mt-5 text-center">
              <Button to={roomPath(mode, 'verify', sel.revealed.roundId)} variant="red">
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
          {state.kind === 'done' ? (
            <div className="wrap relative mb-10 empty:hidden">
              <WinnerBanner
                mode={mode}
                round={round}
                account={accountId}
                verified={state.result.pass}
                matched={state.result.matched}
                total={state.result.total}
              />
            </div>
          ) : null}
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
                  sound="seal"
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
