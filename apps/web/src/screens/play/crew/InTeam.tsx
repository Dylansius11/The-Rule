import { useState } from 'react';
import { Link } from 'react-router';
import { roomPath } from '@/app/paths';
import { formatNear, formatRule } from '@/chain/format';
import { active } from '@/config/env';
import { useEntity, useLatestRound, useLog, useTeamActions } from '@/game';
import type { Team } from '@/game/types';
import { ActionSlip } from '@/ui/ActionSlip';
import { Amount } from '@/ui/Amount';
import { AmountField, readNear } from '@/ui/AmountField';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { isActive, phaseLabel, pad3 } from '@/screens/shared/round';
import { Roster } from './Roster';
import { CopyField, TextField, busy } from './parts';
import { inviteLink } from './invite';
import { depositShares, teamMinted } from './vault';

export function InTeam({ team, me }: { team: Team; me: string }) {
  const actions = useTeamActions();
  const [inv, setInv] = useState('');
  const [dep, setDep] = useState('');
  const d = readNear(dep);
  const round = useLatestRound(1);
  const entity = useEntity(1, round.data?.roundId ?? null, me);
  const live = round.data && isActive(round.data) ? round.data : null;
  const captain = team.captain === me;
  const log = useLog(1, round.data?.roundId);
  const minted = teamMinted(log.rows, team.teamId, me);

  return (
    <div className="grid gap-6">
      <InkBox
        className="flex flex-wrap items-center justify-between gap-3 p-4"
        fill="var(--color-sun)"
        tilt={0.5}
      >
        <div>
          <div className="mono text-[12px] font-bold uppercase tracking-widest">Team #{team.teamId}</div>
          <h2 className="display text-[44px] leading-none">{team.name}</h2>
        </div>
        <div className="mono text-[14px] font-bold">
          {team.members.length} {team.members.length === 1 ? 'member' : 'members'}
        </div>
      </InkBox>

      <InkBox className="grid gap-3 p-4 sm:grid-cols-3" fill="var(--color-paper)" tilt={-0.2}>
        <div>
          <div className="mono text-[12px] font-bold uppercase tracking-widest">In the vault</div>
          <div className="text-[22px]">
            <Amount kind="near" value={team.vault} digits={3} />
          </div>
          <p className="text-[13px] font-semibold">
            {team.activeRound !== null
              ? `Round ${team.activeRound} is using part of it until it settles.`
              : team.weight > 0n
                ? `${formatNear(team.weight, 3)} NEAR put in by the crew.`
                : 'Nothing deposited yet.'}
          </p>
        </div>
        <div>
          <div className="mono text-[12px] font-bold uppercase tracking-widest">Round pot</div>
          <div className="text-[22px]">
            <Amount kind="near" value={round.data?.pot ?? 0n} digits={3} />
          </div>
          <p className="text-[13px] font-semibold">
            {round.data
              ? `Team round ${round.data.roundId}, shared by the whole team.`
              : 'No team round yet.'}
          </p>
        </div>
        <div>
          <div className="mono text-[12px] font-bold uppercase tracking-widest">RULE earned</div>
          <div className="text-[22px]">
            <Amount kind="rule" value={minted.mine} />
          </div>
          <p className="text-[13px] font-semibold">
            You, this round
            {team.members.length > 1 ? `. The team minted ${formatRule(minted.total)} RULE.` : '.'}
          </p>
        </div>
      </InkBox>

      <InkBox className="p-4" fill="#fff" tilt={-0.3}>
        <CopyField
          label="Invite link"
          value={inviteLink(window.location.origin, team.teamId, active.kind === 'demo' ? 'demo' : 'main')}
        />
        <p className="mt-1 text-[14px] font-semibold">
          Send this to a friend, then add their account name under “Invite a member”. The link opens the right
          game (Demo or real) with your team id filled in; it does not let anyone in without your invite.
          {captain ? '' : ' Only the captain can send invites.'}
        </p>
      </InkBox>

      <Roster team={team} me={me} />

      <div className="grid gap-6 md:grid-cols-2">
        <InkBox className="p-5" fill="#fff" tilt={0.6}>
          <h3 className="display text-[34px] leading-none">Vault</h3>
          <p className="mb-3 mt-2 font-semibold">
            Team plays and stakes are paid from the vault. Each deposit is recorded by depositor. Unused
            principal comes back pro rata between rounds; round rewards are split equally.
          </p>
          <AmountField
            label="Deposit to vault"
            value={dep}
            onChange={setDep}
            error={d.error}
            disabled={busy(actions.deposit.state)}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              variant="red"
              disabled={d.amount === null}
              busy={busy(actions.deposit.state)}
              onClick={() =>
                d.amount !== null && actions.deposit.run({ teamId: team.teamId, amount: d.amount })
              }
            >
              Deposit
            </Button>
            <Button
              variant="paper"
              busy={busy(actions.withdraw.state)}
              disabled={team.activeRound !== null}
              onClick={() => actions.withdraw.run(team.teamId)}
            >
              Withdraw my share
            </Button>
          </div>
          {team.activeRound !== null ? (
            <p className="mt-2 text-[14px] font-bold">Withdrawals open between rounds.</p>
          ) : null}
          <div className="mt-3 grid gap-3">
            <ActionSlip
              state={actions.deposit.state}
              onReset={actions.deposit.reset}
              doneText="Deposit transaction accepted. The vault above updates when the chain shows it."
            />
            <ActionSlip
              state={actions.withdraw.state}
              onReset={actions.withdraw.reset}
              doneText="Withdrawal sent. Do not retry; confirmation is pending and the vault updates once it is confirmed."
            />
          </div>
          <table className="data-table mt-4">
            <caption className="sr-only">Deposits by member</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Put in</th>
                <th scope="col">Share of vault</th>
              </tr>
            </thead>
            <tbody>
              {team.deposits.length === 0 ? (
                <tr>
                  <td colSpan={3}>No deposits yet.</td>
                </tr>
              ) : (
                depositShares(team).map(x => (
                  <tr key={x.account}>
                    <td className="break-all">{x.account}</td>
                    <td>
                      <Amount kind="near" value={x.amount} digits={3} />
                    </td>
                    <td>{x.percent}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </InkBox>

        <InkBox className="p-5" fill="#fff" tilt={-0.6}>
          <h3 className="display text-[34px] leading-none">Round desk</h3>
          {live ? (
            <>
              <p className="mono mt-2 text-[14px] font-bold">
                Team round {live.roundId} · {phaseLabel(live.phase)}
              </p>
              {entity.data ? (
                <p className="mt-2 font-bold">
                  Shared attempts {entity.data.attempts} of {entity.data.limit}. Team line:{' '}
                  {entity.data.line
                    ? `${pad3(entity.data.line.number)} ${entity.data.line.word}`
                    : 'none yet'}
                  .{entity.data.pending ? ' A team play is waiting for the sealed program.' : ''}
                </p>
              ) : (
                <p className="mt-2 font-bold" aria-busy="true">
                  Reading the team entity…
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 font-bold">
              No team round is running.{' '}
              {round.data
                ? `Last one: round ${round.data.roundId}, ${phaseLabel(round.data.phase).toLowerCase()}.`
                : ''}
            </p>
          )}
          <p className="mt-3 text-[15px] font-semibold">
            Team stamps happen on the{' '}
            <Link to={roomPath(1)} className="font-extrabold underline decoration-2">
              Stamp tab
            </Link>{' '}
            of the Team room. RULE locks for a team round are set on the{' '}
            <Link to="/account" className="font-extrabold underline decoration-2">
              Account page
            </Link>
            .
          </p>
          <div className="mt-5 grid gap-4 border-t-[3px] border-dashed border-ink/40 pt-4">
            <TextField
              id="invite"
              label="Invite a member"
              value={inv}
              onChange={setInv}
              placeholder="friend.testnet"
              hint={
                captain
                  ? 'Only the captain can invite. Max team size applies.'
                  : 'Only the captain can invite.'
              }
            />
            <div>
              <Button
                variant="grape"
                size="sm"
                disabled={!captain || inv.trim() === '' || team.activeRound !== null}
                busy={busy(actions.invite.state)}
                onClick={() => actions.invite.run(inv.trim())}
              >
                Send invite
              </Button>
            </div>
            <ActionSlip
              state={actions.invite.state}
              onReset={actions.invite.reset}
              doneText="Invite sent. They can now join from your invite link or with this team id."
            />
            <div>
              <Button
                variant="paper"
                size="sm"
                disabled={team.activeRound !== null}
                busy={busy(actions.leave.state)}
                onClick={() => actions.leave.run()}
              >
                Leave team
              </Button>
              <p className="mt-1 text-[14px] font-semibold">
                After leaving you can still claim and settle past rounds with the original team id.
              </p>
            </div>
            <ActionSlip
              state={actions.leave.state}
              onReset={actions.leave.reset}
              doneText="Leave sent. This page updates when the chain shows it."
            />
          </div>
        </InkBox>
      </div>
    </div>
  );
}
