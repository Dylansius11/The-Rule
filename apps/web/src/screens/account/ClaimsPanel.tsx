import { toUiError } from '@/chain/errors';
import { formatNear } from '@/chain/format';
import { useClaimActions, useClaimable, useWallet } from '@/game';
import { useRoundHistory } from '@/game/reads';
import type { Mode } from '@/game/types';
import { ActionSlip } from '@/ui/ActionSlip';
import { Amount } from '@/ui/Amount';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';
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

/** Pull-based payouts for observed rounds. Team rewards are claimed on the Team desk with the team id. */
export function ClaimsPanel() {
  const solo = useRoundHistory(0);
  const team = useRoundHistory(1);
  const rows = [
    ...solo.rounds.slice(0, 6).map(round => ({ mode: 0 as Mode, id: round.roundId })),
    ...team.rounds.slice(0, 6).map(round => ({ mode: 1 as Mode, id: round.roundId })),
  ];
  return (
    <InkBox className="p-5 md:p-6" fill="var(--color-paper)" tilt={0.5}>
      <h3 className="display text-[34px] leading-none">Claims</h3>
      <p className="mt-2 text-[16px] font-semibold">
        When a round settles, what you are owed (the winning prize or your contributor share of the pot) waits
        in the contract until you pull it. Claim moves it into your play credit; moving credit to your wallet
        is a separate step. Team rewards are claimed on the Team desk.
      </p>
      <p className="mt-2 text-[15px] font-semibold">
        Showing up to six observed rounds per mode from a window of at most 30 IDs ending at the latest round.
        The contract only supports lookup by ID; older rounds may exist outside the window.
      </p>
      {(
        [
          ['Solo', solo],
          ['Team', team],
        ] as const
      ).map(([name, history]) =>
        history.error != null ? (
          <ErrorCard
            key={name}
            className="mt-3"
            error={{
              ...toUiError(history.error),
              title: `Could not read all ${name} rounds`,
              funds: 'No transaction was sent.',
              retryable: true,
            }}
            onRetry={history.retry}
          />
        ) : null,
      )}
      {solo.loading || team.loading ? (
        <p className="mt-3 font-bold" aria-busy="true">
          Reading rounds…
        </p>
      ) : null}
      {!solo.loading && !team.loading && solo.error == null && team.error == null && rows.length === 0 ? (
        <p className="mt-3 font-bold">No rounds found.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-3 grid gap-3">
          {rows.map(r => (
            <ClaimRow key={`${r.mode}-${r.id}`} mode={r.mode} roundId={r.id} />
          ))}
        </ul>
      ) : null}
    </InkBox>
  );
}
