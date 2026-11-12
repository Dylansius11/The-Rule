import type { Round } from '@/game/types';
import { Tag } from '@/ui/Tag';
import { clockText, formatCountdown } from './clock';
import { isActive, phaseLabel } from './round';
import { SettleRound } from './SettleRound';
import { useRoundClock } from './useRoundClock';

const URGENT_MS = 60_000;

/**
 * The visible countdown for the round's current deadline: plays while plays are open, the reveal window while it
 * is open. After a deadline it says so in words instead of showing a stale "open" label.
 */
export function RoundTimer({ round, className = '' }: { round: Round; className?: string }) {
  const clock = useRoundClock(round);
  if (clock.stage === 'none') return null;
  const live = clock.stage === 'plays-open' || clock.stage === 'reveal-open';
  const urgent = live && clock.remainingMs < URGENT_MS;
  const start = clock.stage === 'plays-open' ? round.sealedAtMs : round.freezeMs;
  const total = start !== null && clock.deadlineMs !== null ? clock.deadlineMs - start : 0;
  const ratio = live && total > 0 ? Math.min(1, clock.remainingMs / total) : 0;
  const what = clock.stage === 'plays-open' ? 'Plays close in' : 'Reveal closes in';

  return (
    <div role="timer" aria-label={clockText(clock)} className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono text-[13px] font-bold uppercase tracking-wide">
          {live ? what : clockText(clock)}
        </span>
        {live ? (
          <span
            className={`display text-[36px] leading-none tabular-nums ${urgent ? 'text-tomato-deep' : ''}`}
          >
            {formatCountdown(clock.remainingMs)}
          </span>
        ) : null}
      </div>
      {live ? (
        <div
          className="meter mt-1.5"
          data-tone={urgent ? 'tomato' : 'sun'}
          data-ticking="true"
          aria-hidden="true"
        >
          <i style={{ width: `${ratio * 100}%` }} />
        </div>
      ) : null}
      {clock.stage === 'plays-closed' ? (
        <p className="mt-1 text-[14px] font-semibold">
          New plays and guesses are rejected now. Sealed guesses can still be revealed.
        </p>
      ) : null}
      {clock.stage === 'plays-closed' || clock.stage === 'reveal-ended' ? (
        <SettleRound round={round} className="mt-2" />
      ) : null}
    </div>
  );
}

/**
 * The round's phase as a tag that follows the deadline: `Plays open`, `Plays closed` and the reveal window turn
 * over on time even while the chain still stores the older phase. Pass `ticking` to show the live countdown.
 */
export function RoundStatusTag({ round, ticking = false }: { round: Round; ticking?: boolean }) {
  const clock = useRoundClock(round);
  const text = clockText(clock);
  const label = ticking && text ? text : stageLabel(round, clock.stage);
  return <Tag tone={isActive(round) && clock.stage !== 'plays-closed' ? 'sun' : 'soft'}>{label}</Tag>;
}

function stageLabel(round: Round, stage: ReturnType<typeof useRoundClock>['stage']): string {
  if (stage === 'plays-closed') return 'Plays closed';
  if (stage === 'reveal-ended') return 'Reveal ended';
  return phaseLabel(round.phase);
}
