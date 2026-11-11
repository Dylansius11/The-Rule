import { useState } from 'react';
import { formatNear } from '@/chain/format';
import {
  useClaimActions,
  useClaimable,
  useLatestRound,
  useRound,
  useTeam,
  useTeamActions,
  useWallet,
} from '@/game';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { phaseLabel } from '@/screens/shared/round';
import { TextField, busy } from './parts';

function parseId(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isInteger(id) && id <= 0xffff_ffff ? id : null;
}

/**
 * What a team does once its round ends. Two separate on-chain steps, in plain words:
 * 1. unlock the team: return correct stakes (and refunded fees) to the vault and reopen deposits, invites and leaving;
 * 2. claim your equal share of the reward into your own game credit.
 * The round and team default to the newest round and your team; a past round or an old team id is under "Use another".
 */
export function PastRounds({ teamIdGuess }: { teamIdGuess: number | null }) {
  const { accountId } = useWallet();
  const latest = useLatestRound(1);
  const [roundInput, setRoundInput] = useState('');
  const roundId = roundInput === '' ? (latest.data?.roundId ?? null) : parseId(roundInput);
  const selected = useRound(1, roundId);
  const round = selected.data ?? null;
  const [tid, setTid] = useState(teamIdGuess === null ? '' : String(teamIdGuess));
  const settle = useTeamActions().settle;
  const claims = useClaimActions(1, roundId ?? 0);
  const id = parseId(tid);
  const team = useTeam(id);
  const owed = useClaimable(1, roundId, accountId);
  const done = !!round && ['Settled', 'Cancelled', 'Void'].includes(round.phase);
  const unlocked = team.data != null && team.data.activeRound === null;
  const canSettle = id !== null && done && !unlocked;
  const canClaim = id !== null && done && !!round;

  return (
    <InkBox className="p-5" fill="var(--color-paper)" tilt={0.5}>
      <h3 className="display text-[34px] leading-none">After the round</h3>
      <p className="mb-3 mt-2 font-semibold">
        When a team round ends, do these two steps. Each is a separate signature, and both use the original
        round and team ids, even after you leave.
      </p>
      {round ? (
        <p className="mono mb-3 text-[14px] font-bold">
          Team round {round.roundId} · {phaseLabel(round.phase)}
          {id !== null ? ` · team #${id}` : ''}
        </p>
      ) : null}

      <ol className="grid gap-5">
        <li>
          <p className="font-extrabold">1. Unlock the team</p>
          <p className="text-[15px] font-semibold">
            While a round runs, the team is locked: nobody can deposit, invite or leave. Unlocking returns the
            team&apos;s correct stakes to the vault and opens the team again. Any account can do it.
          </p>
          <div className="mt-2">
            <Button
              variant="grape"
              size="sm"
              disabled={!canSettle}
              busy={busy(settle.state)}
              onClick={() => id !== null && settle.run(id)}
            >
              Unlock team
            </Button>
          </div>
          <p className="mt-1 text-[14px] font-bold">
            {!done
              ? 'Available once the team round has ended.'
              : unlocked
                ? 'Your team is already unlocked.'
                : id === null
                  ? 'Enter a team id below.'
                  : ''}
          </p>
        </li>
        <li>
          <p className="font-extrabold">2. Claim your share</p>
          <p className="text-[15px] font-semibold">
            Rewards are split equally among the members on the round&apos;s roster. Claiming puts your share
            in your game credit; withdraw credit to your wallet from the Account page.
          </p>
          {owed.data !== undefined && owed.data > 0n ? (
            <p className="mt-1 font-extrabold">You can claim {formatNear(owed.data, 4)} NEAR.</p>
          ) : null}
          <div className="mt-2">
            <Button
              variant="red"
              size="sm"
              disabled={!canClaim}
              busy={busy(claims.claimTeam.state)}
              onClick={() => id !== null && claims.claimTeam.run(id)}
            >
              Claim my reward
            </Button>
          </div>
        </li>
      </ol>

      <div className="mt-4 grid gap-3">
        <ActionSlip
          state={settle.state}
          onReset={settle.reset}
          doneText="Unlock sent. The team opens again once the chain processes it."
        />
        <ActionSlip
          state={claims.claimTeam.state}
          onReset={claims.claimTeam.reset}
          doneText="Reward added to your play credit. Withdraw credit separately to move it to your wallet."
        />
      </div>

      <details className="mt-4">
        <summary className="min-h-[44px] cursor-pointer font-extrabold underline decoration-2 underline-offset-2">
          Use another round or team
        </summary>
        <div className="mt-2 max-w-[260px]">
          <TextField
            id="past-round"
            label="Round id"
            value={roundInput}
            onChange={setRoundInput}
            placeholder={latest.data ? String(latest.data.roundId) : 'e.g. 0'}
          />
        </div>
        <div className="mt-2 max-w-[260px]">
          <TextField id="past-team" label="Team id" value={tid} onChange={setTid} placeholder="e.g. 3" />
        </div>
      </details>
    </InkBox>
  );
}
