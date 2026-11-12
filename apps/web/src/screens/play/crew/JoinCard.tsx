import { Link } from 'react-router';
import { toUiError } from '@/chain/errors';
import { active } from '@/config/env';
import { isTerminalPhase } from '@/game/payouts';
import { useParams, usePlayer, useRound, useTeam, useTeamActions, useWallet } from '@/game';
import { useConnect } from '@/layout/useConnect';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { joinStatus, requestLink, type JoinStatus } from './invite';
import { CopyField, busy } from './parts';

const MESSAGE: Record<JoinStatus, string> = {
  invited: 'The captain invited you. Enter the team to share its vault and its line.',
  member: 'You are already on this team.',
  'in-other-team': 'You are on another team. Leave it from its desk first; an account can be on one team.',
  'not-invited':
    'The captain has not invited this account yet. Send them your account name with the link below.',
  full: 'This team is full.',
  locked: 'The team is in the middle of a round. Come back when the round ends.',
  'no-player': 'Add some game credit first. It also pays for your plays.',
};

const LOCKED_ENDED =
  "This team's round has ended, but the team stays locked until someone unlocks it. Anyone can, and it costs only gas.";

/**
 * The guided join: read the team, connect, check every condition the contract checks, then one button. Used by the
 * invite link and by a typed team id. A team id is read from the chain, so it needs no wallet to preview.
 */
export function JoinCard({ teamId, prominent = false }: { teamId: number; prominent?: boolean }) {
  const { wallet, connect, busy: connecting, error, clear } = useConnect();
  const { accountId } = useWallet();
  const params = useParams();
  const team = useTeam(teamId);
  const player = usePlayer(accountId);
  const { join, settle } = useTeamActions();
  const lockedRound = useRound(1, team.data?.activeRound ?? null);
  const lockedEnded = lockedRound.data ? isTerminalPhase(lockedRound.data.phase) : false;
  const connected = wallet.status === 'connected' && !!accountId;

  const status: JoinStatus | null =
    team.data && params.data
      ? joinStatus(
          team.data,
          {
            account: connected ? accountId : null,
            teamId: player.data?.teamId ?? null,
            isPlayer: !!player.data,
          },
          params.data.maxTeamSize,
        )
      : null;
  const origin = window.location.origin;
  const deployment = active.kind === 'demo' ? 'demo' : 'main';

  return (
    <InkBox
      className="p-5 md:p-6"
      fill={prominent ? 'var(--color-sun)' : '#fff'}
      tilt={prominent ? -0.4 : 0.6}
    >
      {team.isError ? (
        <ErrorCard error={toUiError(team.error)} onRetry={() => void team.refetch()} />
      ) : team.isPending ? (
        <p className="font-bold" aria-busy="true">
          Reading team {teamId}…
        </p>
      ) : team.data === null ? (
        <p className="font-extrabold">
          No team #{teamId} exists on {active.kind === 'demo' ? 'Demo Mode' : 'the real game'}. If the captain
          is on the other one, use the Live / Demo switch under the header.
        </p>
      ) : team.data ? (
        <>
          <p className="mono text-[12px] font-bold uppercase tracking-widest">
            {status === 'invited' ? 'You are invited to' : `Team #${team.data.teamId}`}
          </p>
          <h3 className="display text-[clamp(34px,6vw,52px)] leading-none">{team.data.name}</h3>
          <p className="mt-1 text-[15px] font-semibold">
            Captain {team.data.captain} · {team.data.members.length}
            {params.data ? ` of ${params.data.maxTeamSize}` : ''} members
          </p>

          {!connected ? (
            <div className="mt-4">
              <p className="font-extrabold">Connect your wallet to join.</p>
              <div className="mt-2">
                <Button variant="red" size="lg" onClick={connect} busy={connecting}>
                  Connect wallet
                </Button>
              </div>
              {error ? (
                <div className="mt-3">
                  <ErrorCard error={error} onRetry={connect} onDismiss={clear} />
                </div>
              ) : null}
            </div>
          ) : player.isLoading || status === null ? (
            <p className="mt-4 font-bold" aria-busy="true">
              Checking your invitation…
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              <p className="font-extrabold" role="status">
                {status === 'locked' && lockedEnded ? LOCKED_ENDED : MESSAGE[status]}
              </p>
              {status === 'invited' ? (
                <div>
                  <Button variant="grape" size="lg" busy={busy(join.state)} onClick={() => join.run(teamId)}>
                    Enter the team
                  </Button>
                  {team.data.vault !== team.data.weight ? (
                    <p className="mt-2 text-[14px] font-semibold">
                      Plays have spent part of this vault, so new deposits stay closed until every depositor
                      has withdrawn their share. You can still join and play from the vault.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {status === 'no-player' || (status === 'not-invited' && !player.data) ? (
                <div>
                  <Link to="/account" className="font-extrabold underline decoration-2">
                    Open the Account page to add credit
                  </Link>
                </div>
              ) : null}
              {status === 'not-invited' && accountId ? (
                <div className="grid gap-2">
                  <CopyField
                    label="Send this to the captain"
                    value={requestLink(origin, accountId, deployment)}
                  />
                  <p className="text-[14px] font-semibold">
                    It opens the captain&apos;s team desk with {accountId} already typed in, so they only
                    press Invite. Then come back to this page.
                  </p>
                </div>
              ) : null}
              {status === 'locked' && lockedEnded ? (
                <div>
                  <Button variant="red" busy={busy(settle.state)} onClick={() => settle.run(teamId)}>
                    Unlock this team
                  </Button>
                  <ActionSlip
                    state={settle.state}
                    onReset={settle.reset}
                    doneText="Unlock sent. When the chain shows it, this card checks your invitation again."
                  />
                </div>
              ) : null}
              <ActionSlip
                state={join.state}
                onReset={join.reset}
                doneText="You are in. This page shows your team as soon as the chain does; then add your share to the vault."
              />
            </div>
          )}
        </>
      ) : null}
    </InkBox>
  );
}
