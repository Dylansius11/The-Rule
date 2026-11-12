import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toUiError } from '@/chain/errors';
import { active } from '@/config/env';
import { useParams, useTeam, useTeamActions, useWallet } from '@/game';
import { TEAM_NAME_HINT, validTeamName } from '@/game/team-name';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { joinIdFromSearch, joinStatus } from './invite';
import { CopyField, TextField, busy } from './parts';

export function NoTeam() {
  const actions = useTeamActions();
  const [search] = useSearchParams();
  const { accountId } = useWallet();
  const params = useParams();
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState(() => {
    const fromLink = joinIdFromSearch(search.toString());
    return fromLink === null ? '' : String(fromLink);
  });
  const id = /^\d+$/.test(joinId.trim()) ? Number(joinId.trim()) : null;
  const team = useTeam(id);
  const status = team.data && params.data ? joinStatus(team.data, accountId, params.data.maxTeamSize) : null;
  const canJoin = id !== null && status === 'invited';
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <InkBox className="p-5" fill="#fff" tilt={-0.6}>
        <h3 className="display text-[34px] leading-none">Start a team</h3>
        <p className="mb-3 mt-2 font-semibold">
          Up to five members share one vault, one attempt limit and one line. You become captain. The team id
          is assigned by the contract when it is created, and shown here with an invite link.
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
        <h3 className="display text-[34px] leading-none">Join a team</h3>
        <p className="mb-3 mt-2 font-semibold">
          Open the invite link the captain sent, or type the team id. The captain must also have invited your
          account name; a link on its own does not let anyone in.
        </p>
        <TextField id="join-id" label="Team id" value={joinId} onChange={setJoinId} placeholder="e.g. 3" />

        {id !== null ? (
          <div className="mt-3 rounded-2xl border-[3px] border-ink bg-paper p-3" aria-live="polite">
            {team.isError ? (
              <ErrorCard error={toUiError(team.error)} onRetry={() => void team.refetch()} />
            ) : team.isPending ? (
              <p className="font-bold" aria-busy="true">
                Reading team {id}…
              </p>
            ) : team.data === null ? (
              <p className="font-extrabold">
                No team #{id} exists on {active.kind === 'demo' ? 'Demo Mode' : 'the real game'}. If the
                captain is on the other one, use the Live / Demo switch under the header.
              </p>
            ) : team.data ? (
              <>
                <p className="mono text-[12px] font-bold uppercase tracking-widest">
                  Team #{team.data.teamId}
                </p>
                <p className="display text-[30px] leading-none">{team.data.name}</p>
                <p className="mt-1 text-[14px] font-semibold">
                  Captain {team.data.captain} · {team.data.members.length}
                  {params.data ? ` of ${params.data.maxTeamSize}` : ''} members
                </p>
                <p className="mt-2 font-extrabold" role="status">
                  {status === 'invited'
                    ? 'You are invited. Join to share the vault and the line.'
                    : status === 'full'
                      ? 'This team is full.'
                      : status === 'member'
                        ? 'You are already on this team.'
                        : 'You are not invited yet. Send the captain your account name, then come back.'}
                </p>
                {status === 'not-invited' && accountId ? (
                  <div className="mt-2">
                    <CopyField label="Your account name" value={accountId} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3">
          <Button
            variant="grape"
            disabled={!canJoin}
            busy={busy(actions.join.state)}
            onClick={() => canJoin && actions.join.run(id)}
          >
            Join team
          </Button>
        </div>
        <div className="mt-3">
          <ActionSlip
            state={actions.join.state}
            onReset={actions.join.reset}
            doneText="Join sent. The roster updates when the chain shows it."
          />
        </div>
      </InkBox>
    </div>
  );
}
