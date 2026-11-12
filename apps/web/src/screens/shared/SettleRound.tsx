import { useSettleAction } from '@/game';
import type { Round } from '@/game/types';
import { useConnect } from '@/layout/useConnect';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { useRoundClock } from './useRoundClock';

/** The keeper normally settles within about a minute of a deadline; after this the player may do it. */
export const KEEPER_GRACE_MS = 90_000;

/**
 * Nobody has moved the round on after its deadline. `advance` and `finalize` are permissionless and
 * deposit-free, so any player can send them when the keeper is late or switched off. Renders nothing
 * while the round is not waiting on one of them.
 */
export function SettleRound({ round, className = '' }: { round: Round; className?: string }) {
  const clock = useRoundClock(round);
  const settle = useSettleAction(round.mode, round.roundId);
  const { wallet, connect, busy: connecting } = useConnect();
  const step =
    clock.stage === 'plays-closed' ? 'advance' : clock.stage === 'reveal-ended' ? 'finalize' : null;
  if (step === null || clock.deadlineMs === null) return null;

  const late = Date.now() - clock.deadlineMs > KEEPER_GRACE_MS;
  const sending = settle.state.kind === 'signing' || settle.state.kind === 'pending';
  const what =
    step === 'advance' ? 'move the round into its reveal window' : 'open the rule and pay out the round';

  return (
    <div className={className}>
      {late ? (
        <>
          <p className="text-[14px] font-semibold">
            The keeper has not moved this round on yet. Anyone can: one transaction to {what}. It costs only
            gas, no deposit.
          </p>
          <div className="mt-2">
            {wallet.status === 'connected' ? (
              <Button
                variant="paper"
                size="sm"
                busy={sending}
                disabled={sending}
                onClick={() => settle.run(step)}
              >
                {step === 'advance' ? 'Advance the round' : 'Settle the round'}
              </Button>
            ) : (
              <Button variant="paper" size="sm" busy={connecting} onClick={connect}>
                Connect to settle
              </Button>
            )}
          </div>
          <div className="mt-2">
            <ActionSlip
              state={settle.state}
              doneText={
                step === 'advance'
                  ? 'Sent. The round moves into its reveal window.'
                  : 'Sent. The sealed program is opening the rule. If this page still shows Reveal ended afterwards, press once more: large sweeps need more than one pass.'
              }
              onReset={settle.reset}
            />
          </div>
        </>
      ) : (
        <p className="text-[14px] font-semibold">
          Waiting for the keeper to {what}. This normally takes under a minute.
        </p>
      )}
    </div>
  );
}
