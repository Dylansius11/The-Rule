import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTeamActions } from '@/game';
import { TEAM_NAME_HINT, validTeamName } from '@/game/team-name';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { joinIdFromSearch } from './invite';
import { JoinCard } from './JoinCard';
import { TextField, busy } from './parts';

export function NoTeam() {
  const actions = useTeamActions();
  const [search] = useSearchParams();
  const linkId = joinIdFromSearch(search.toString());
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
  const typedId = /^\d+$/.test(joinId.trim()) ? Number(joinId.trim()) : null;

  return (
    <div className="grid gap-6">
      {linkId !== null ? <JoinCard teamId={linkId} prominent /> : null}
      <div className="grid gap-6 md:grid-cols-2">
        <InkBox className="p-5" fill="#fff" tilt={-0.6}>
          <h3 className="display text-[34px] leading-none">Start a team</h3>
          <p className="mb-3 mt-2 font-semibold">
            Up to five members share one vault, one attempt limit and one line. You become captain. The team
            id is assigned by the contract when it is created, and shown here with an invite link.
          </p>
          <TextField
            id="team-name"
            label="Team name"
            value={name}
            onChange={setName}
            placeholder="ink-gang"
            hint={TEAM_NAME_HINT}
            error={name !== '' && !validTeamName(name) ? TEAM_NAME_HINT : undefined}
          />
          <div className="mt-3">
            <Button
              variant="red"
              disabled={!validTeamName(name)}
              busy={busy(actions.create.state)}
              onClick={() => validTeamName(name) && actions.create.run(name)}
            >
              Create team
            </Button>
          </div>
          <div className="mt-3">
            <ActionSlip
              state={actions.create.state}
              onReset={actions.create.reset}
              doneText="Team creation sent. This page shows the team and its id when the chain does."
            />
          </div>
        </InkBox>
        <InkBox className="p-5" fill="#fff" tilt={0.6}>
          <h3 className="display text-[34px] leading-none">Join with a team id</h3>
          <p className="mb-3 mt-2 font-semibold">
            Have a team id instead of a link? Type it here. The captain must also have invited your account
            name; an id on its own does not let anyone in.
          </p>
          <TextField id="join-id" label="Team id" value={joinId} onChange={setJoinId} placeholder="e.g. 3" />
          {typedId !== null && typedId !== linkId ? (
            <div className="mt-3">
              <JoinCard teamId={typedId} />
            </div>
          ) : null}
        </InkBox>
      </div>
    </div>
  );
}
