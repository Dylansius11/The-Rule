import type { Round } from '@/game/types';
import { useRoundClock } from './useRoundClock';

/**
 * A round whose deadline passed is moved on by the keeper (`advance` after plays close, `finalize` after the
 * reveal window). The page does not send those itself; it says what is being waited for. Renders nothing
 * while the round is not waiting on one of them.
 */
export function KeeperWait({ round, className = '' }: { round: Round; className?: string }) {
  const clock = useRoundClock(round);
  const what =
    clock.stage === 'plays-closed'
      ? 'move the round into its reveal window'
      : clock.stage === 'reveal-ended'
        ? 'open the rule and pay out the round'
        : null;
  if (what === null || clock.deadlineMs === null) return null;
  return (
    <p className={`text-[14px] font-semibold ${className}`} role="status">
      Waiting for the keeper to {what}. It usually lands within a minute or two. If this stays for much
      longer, the keeper is not running; the step can still be sent by hand outside this page.
    </p>
  );
}
