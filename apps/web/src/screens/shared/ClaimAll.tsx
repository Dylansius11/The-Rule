import { useEffect, useRef } from 'react';
import { formatNear } from '@/chain/format';
import { useSessionKey } from '@/chain/session/useSessionKey';
import { useClaimAll, usePayouts, useWallet } from '@/game';
import { modeName } from '@/screens/shared/round';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';

/**
 * One button for everything the signed-in account is owed: unlock its team after a round and claim every ended
 * round's share into game credit. It renders nothing when there is nothing to collect, so it never nags. NEAR only
 * leaves the game through the separate withdraw on the Account page.
 */
export function ClaimAll({ className = '' }: { className?: string }) {
  const { accountId } = useWallet();
  const payouts = usePayouts(accountId);
  const send = useClaimAll();
  const working = send.state.kind === 'signing' || send.state.kind === 'pending';
  const session = useSessionKey();
  const silent = session.status === 'active' || session.status === 'low';
  const unlock = payouts.items.find(item => item.kind === 'unlock');
  const tried = useRef<string | null>(null);

  // Unlocking only returns the team's own stakes to its vault and moves no money out, so with a session key
  // it is sent without asking. Each round is tried once per page, so a failure is shown, not retried in a
  // loop, and a later round unlocks again after an earlier one finished.
  useEffect(() => {
    if (!unlock || !silent || working) return;
    const key = `${unlock.teamId}:${unlock.roundId}`;
    if (tried.current === key) return;
    tried.current = key;
    send.run([unlock]);
  }, [unlock, silent, working, send]);

  // Keep the bar while it is reporting, even after the plan empties because the chain caught up.
  if (!accountId || (payouts.items.length === 0 && send.state.kind === 'idle')) return null;

  return (
    <InkBox className={`p-4 md:p-5 ${className}`} fill="var(--color-lime)" tilt={-0.3}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="display text-[30px] leading-none">Ready to collect</h3>
          <ul className="mt-2 grid gap-1 text-[15px] font-bold">
            {payouts.items.map(item =>
              item.kind === 'unlock' ? (
                <li key={`unlock-${item.teamId}`}>
                  Unlock your team: team round {item.roundId} has ended, so its stakes return to the vault.
                </li>
              ) : (
                <li key={`${item.mode}-${item.roundId}`}>
                  {modeName(item.mode)} round {item.roundId}: {formatNear(item.amount, 4)} NEAR to your
                  credit.
                </li>
              ),
            )}
          </ul>
        </div>
        {payouts.items.length > 0 ? (
          <Button variant="red" size="lg" busy={working} onClick={() => send.run(payouts.items)}>
            {payouts.total > 0n ? `Claim all · ${formatNear(payouts.total, 4)} NEAR` : 'Unlock team'}
          </Button>
        ) : null}
      </div>
      {send.progress && working ? (
        <p className="mt-2 font-bold" aria-live="polite">
          Step {Math.min(send.progress.done + 1, send.progress.total)} of {send.progress.total}…
        </p>
      ) : null}
      <div className="mt-3">
        <ActionSlip
          state={send.state}
          onReset={send.reset}
          doneText="Sent. Your credit and team update when the chain shows it. Withdraw credit to your wallet from the Account page."
        />
      </div>
    </InkBox>
  );
}
