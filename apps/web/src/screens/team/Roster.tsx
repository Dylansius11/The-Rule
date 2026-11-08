import { useTeamActions } from '@/game';
import type { Team } from '@/game/types';
import { ActionSlip } from '@/ui/ActionSlip';
import { InkBox } from '@/ui/InkBox';
import { Tag } from '@/ui/Tag';
import { busy } from './parts';

export function Roster({ team, me }: { team: Team; me: string }) {
  const { remove } = useTeamActions();
  const captain = team.captain === me;
  const weight = (acct: string) => team.deposits.find(d => d.account === acct)?.weight ?? 0n;
  return (
    <InkBox className="p-5" fill="#fff" tilt={-0.6}>
      <h3 className="display text-[34px] leading-none">Roster</h3>
      <ul className="mt-3 flex flex-wrap gap-3">
        {team.members.map((m, i) => (
          <li key={m}>
            <InkBox
              small
              fill={i % 2 ? 'var(--color-bubblegum)' : 'var(--color-sun)'}
              radius="blob-lg"
              tilt={i % 2 ? 1.5 : -1.5}
              className="px-3 py-2"
            >
              <div className="mono break-all text-[14px] font-bold">{m}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {m === team.captain ? <Tag tone="grape">captain</Tag> : null}
                {m === me ? <Tag tone="soft">you</Tag> : null}
                <span className="mono text-[12px] font-bold">weight {weight(m).toString()}</span>
              </div>
              {captain && m !== me ? (
                <button
                  type="button"
                  className="mt-1 min-h-[44px] text-[14px] font-extrabold underline decoration-2"
                  disabled={busy(remove.state) || team.activeRound !== null}
                  onClick={() => remove.run(m)}
                >
                  Remove
                </button>
              ) : null}
            </InkBox>
          </li>
        ))}
      </ul>
      {team.invites.length ? (
        <p className="mono mt-3 text-[13px] font-bold">Invited, not yet joined: {team.invites.join(', ')}</p>
      ) : null}
      {team.activeRound !== null ? (
        <p className="mt-3 font-bold">The roster is locked until round {team.activeRound} ends.</p>
      ) : null}
      <div className="mt-3">
        <ActionSlip
          state={remove.state}
          onReset={remove.reset}
          doneText="Removal sent. The roster above updates when the chain shows it."
        />
      </div>
    </InkBox>
  );
}
