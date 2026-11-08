import { useState } from 'react';
import { useTeamActions } from '@/game';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { TextField, busy } from './parts';

export function NoTeam() {
  const actions = useTeamActions();
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
  const id = /^\d+$/.test(joinId.trim()) ? Number(joinId.trim()) : null;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <InkBox className="p-5" fill="#fff" tilt={-0.6}>
        <h3 className="display text-[34px] leading-none">Start a team</h3>
        <p className="mb-3 mt-2 font-semibold">
          Up to five members share one vault, one attempt limit and one line. You become captain.
        </p>
        <TextField id="team-name" label="Team name" value={name} onChange={setName} placeholder="Ink Gang" />
        <div className="mt-3">
          <Button
            variant="red"
            disabled={name.trim() === ''}
            busy={busy(actions.create.state)}
            onClick={() => actions.create.run(name.trim())}
          >
            Create team
          </Button>
        </div>
        <div className="mt-3">
          <ActionSlip
            state={actions.create.state}
            onReset={actions.create.reset}
            doneText="Team creation sent. This page shows the team when the chain does."
          />
        </div>
      </InkBox>
      <InkBox className="p-5" fill="#fff" tilt={0.6}>
        <h3 className="display text-[34px] leading-none">Join with an invite</h3>
        <p className="mb-3 mt-2 font-semibold">
          A captain invites your account, then you join with the team id they give you.
        </p>
        <TextField id="join-id" label="Team id" value={joinId} onChange={setJoinId} placeholder="e.g. 3" />
        <div className="mt-3">
          <Button
            variant="grape"
            disabled={id === null}
            busy={busy(actions.join.state)}
            onClick={() => id !== null && actions.join.run(id)}
          >
            Join team
          </Button>
        </div>
        <div className="mt-3">
          <ActionSlip
            state={actions.join.state}
            onReset={actions.join.reset}
            doneText="Join sent. If you were invited, the roster updates when the chain shows it."
          />
        </div>
      </InkBox>
    </div>
  );
}
