import { useState } from 'react';
import { Link } from 'react-router';
import { formatNear } from '@/chain/format';
import { useEntity, useLatestRound, useTeamActions } from '@/game';
import type { Team } from '@/game/types';
import { ActionSlip } from '@/ui/ActionSlip';
import { AmountField, readNear } from '@/ui/AmountField';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { isActive, phaseLabel, pad3 } from '../shared/round';
import { Roster } from './Roster';
import { TextField, busy } from './parts';

export function InTeam({ team, me }: { team: Team; me: string }) {
  const actions = useTeamActions();
  const [inv, setInv] = useState('');
  const [dep, setDep] = useState('');
  const d = readNear(dep);
  const round = useLatestRound(1);
  const entity = useEntity(1, round.data?.roundId ?? null, me);
  const live = round.data && isActive(round.data) ? round.data : null;
  const captain = team.captain === me;

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
          vault <b>{formatNear(team.vault, 3)} NEAR</b>
        </div>
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
              doneText="Withdrawal sent, waiting for the transfer. Do not retry; the vault updates when it settles."
            />
          </div>
          <table className="data-table mt-4">
            <caption className="sr-only">Depositor weights</caption>
            <thead>
              <tr>
                <th scope="col">Depositor</th>
                <th scope="col">Weight</th>
              </tr>
            </thead>
            <tbody>
              {team.deposits.length === 0 ? (
                <tr>
                  <td colSpan={2}>No deposits yet.</td>
                </tr>
              ) : (
                team.deposits.map(x => (
                  <tr key={x.account}>
                    <td className="break-all">{x.account}</td>
                    <td>{x.weight.toString()}</td>
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
            <Link to="/" className="font-extrabold underline decoration-2">
              Play desk
            </Link>{' '}
            in Team mode. RULE locks for a team round are set on the{' '}
            <Link to="/wallet" className="font-extrabold underline decoration-2">
              Wallet
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
              doneText="Invite sent. They can join with this team id."
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
