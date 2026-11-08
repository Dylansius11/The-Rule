import { useState } from 'react';
import { useClaimActions, useLatestRound, useTeamActions } from '@/game';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { phaseLabel } from '@/screens/shared/round';
import { TextField, busy } from './parts';

export function PastRounds({ teamIdGuess }: { teamIdGuess: number | null }) {
  const latest = useLatestRound(1);
  const round = latest.data ?? null;
  const [tid, setTid] = useState(teamIdGuess === null ? '' : String(teamIdGuess));
  const settle = useTeamActions().settle;
  const claims = useClaimActions(1, round?.roundId ?? 0);
  const id = /^\d+$/.test(tid.trim()) ? Number(tid.trim()) : null;
  const done = round && ['Settled', 'Cancelled', 'Void'].includes(round.phase);
  return (
    <InkBox className="p-5" fill="var(--color-paper)" tilt={0.5}>
      <h3 className="display text-[34px] leading-none">Settle &amp; claim</h3>
      <p className="mb-3 mt-2 font-semibold">
        Rewards are equal per member and use the original team id, even after you leave.
      </p>
      {round ? (
        <p className="mono mb-3 text-[14px] font-bold">
          Team round {round.roundId} · {phaseLabel(round.phase)}
        </p>
      ) : null}
      <div className="max-w-[260px]">
        <TextField id="past-team" label="Team id" value={tid} onChange={setTid} placeholder="e.g. 3" />
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          variant="grape"
          size="sm"
          disabled={id === null || !done}
          busy={busy(settle.state)}
          onClick={() => id !== null && settle.run(id)}
        >
          Settle team
        </Button>
        <Button
          variant="red"
          size="sm"
          disabled={id === null || !done || !round}
          busy={busy(claims.claimTeam.state)}
          onClick={() => id !== null && claims.claimTeam.run(id)}
        >
          Claim team reward
        </Button>
      </div>
      {!done ? <p className="mt-2 font-bold">Available once the team round has ended.</p> : null}
      <div className="mt-3 grid gap-3">
        <ActionSlip
          state={settle.state}
          onReset={settle.reset}
          doneText="Settle sent. The result shows on the chain once processed."
        />
        <ActionSlip
          state={claims.claimTeam.state}
          onReset={claims.claimTeam.reset}
          doneText="Claim sent. The payout transfer is a separate step: check your wallet NEAR in a moment."
        />
      </div>
    </InkBox>
  );
}
