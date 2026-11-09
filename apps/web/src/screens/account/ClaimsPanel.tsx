import { formatNear } from '@/chain/format';
import { useClaimActions, useClaimable, useNextSlot, useWallet } from '@/game';
import type { Mode } from '@/game/types';
import { ActionSlip } from '@/ui/ActionSlip';
import { Amount } from '@/ui/Amount';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { modeName } from '../shared/round';

function ClaimRow({ mode, roundId }: { mode: Mode; roundId: number }) {
  const { accountId } = useWallet();
  const q = useClaimable(mode, roundId, accountId);
  const { claim } = useClaimActions(mode, roundId);
  const amount = q.data ?? 0n;
  const busy = claim.state.kind === 'signing' || claim.state.kind === 'pending';
  return (
    <li className="rounded-lg border-[3px] border-ink bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-extrabold">
          {modeName(mode)} round {roundId}
        </span>
        {q.isLoading ? (
          <span className="mono text-[14px]" aria-busy="true">
            checking…
          </span>
        ) : q.isError ? (
          <span className="mono text-[14px] font-bold text-tomato-deep">could not read</span>
        ) : amount > 0n ? (
          <Amount kind="near" value={amount} digits={4} />
        ) : (
          <span className="mono text-[14px] font-bold text-ink-soft">nothing to claim</span>
        )}
        {amount > 0n ? (
          <Button variant="red" size="sm" busy={busy} onClick={() => claim.run()}>
            Claim
          </Button>
        ) : null}
      </div>
      {claim.state.kind !== 'idle' ? (
        <div className="mt-2">
          <ActionSlip
            state={claim.state}
            onReset={claim.reset}
            doneText={
              claim.state.kind === 'done' && typeof claim.state.value === 'string'
                ? `${formatNear(BigInt(claim.state.value), 4)} NEAR added to your play credit. Withdraw credit separately to move it to your wallet.`
                : 'Claim submitted. Check your play credit; withdrawal is a separate action.'
            }
          />
        </div>
      ) : null}
    </li>
  );
}

/** Pull-based payouts per finished round. Team rewards are claimed on the Team desk with the team id. */
export function ClaimsPanel() {
  const solo = useNextSlot(0);
  const team = useNextSlot(1);
  const ids = (n: number | undefined) =>
    Array.from({ length: Math.min(6, n ?? 0) }, (_, i) => (n ?? 0) - 1 - i);
  const rows = [
    ...ids(solo.data?.roundId).map(id => ({ mode: 0 as Mode, id })),
    ...ids(team.data?.roundId).map(id => ({ mode: 1 as Mode, id })),
  ];
  return (
    <InkBox className="p-5 md:p-6" fill="var(--color-paper)" tilt={0.5}>
      <h3 className="display text-[34px] leading-none">Claims</h3>
      <p className="mt-2 text-[16px] font-semibold">
        When a round settles, what you are owed (the winning prize or your contributor share of the pot) waits
        in the contract until you pull it. Claim moves it into your play credit; moving credit to your wallet
        is a separate step. Team rewards are claimed on the Team desk.
      </p>
      {solo.isLoading || team.isLoading ? (
        <p className="mt-3 font-bold" aria-busy="true">
          Reading rounds…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 font-bold">No finished rounds yet.</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {rows.map(r => (
            <ClaimRow key={`${r.mode}-${r.id}`} mode={r.mode} roundId={r.id} />
          ))}
        </ul>
      )}
    </InkBox>
  );
}
