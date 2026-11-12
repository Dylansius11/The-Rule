import { useState } from 'react';
import { formatRule } from '@/chain/format';
import { useLatestRound, useNextSlot, useLock, useLockActions, useParams, useWallet } from '@/game';
import { nameTiers } from '@/game/tiers';
import { lockTarget } from '@/game/lock-target';
import { TokenRegistration } from './TokenRegistration';
import type { Mode } from '@/game/types';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { RadioChips } from '@/ui/Chip';
import { InkBox } from '@/ui/InkBox';
import { ModePicker } from '../shared/ModePicker';
import { modeName, phaseLabel } from '../shared/round';

/** Target the Sealing or next round; older materialized rounds remain selectable for unlocking. */
export function LockPanel() {
  const { accountId } = useWallet();
  const [mode, setMode] = useState<Mode>(0);
  const params = useParams();
  const latest = useLatestRound(mode);
  const round = latest.data ?? null;
  const next = useNextSlot(mode);
  const target = latest.isSuccess ? lockTarget(round, next.data?.roundId) : null;
  const [selection, setSelection] = useState<'upcoming' | 'latest'>('upcoming');
  const selectedId = selection === 'latest' ? (round?.roundId ?? null) : target;
  const lockQ = useLock(mode, selectedId, accountId);
  const actions = useLockActions(mode, selectedId ?? 0);
  const [tier, setTier] = useState<number | null>(null);
  const tiers = nameTiers(params.data?.lockTiers ?? []);
  const chosen = tier === null ? null : (tiers[tier] ?? null);
  const lockable = selectedId != null && selectedId === target;
  const locked = lockQ.data ?? 0n;
  const ended =
    selectedId === round?.roundId && !!round && ['Settled', 'Cancelled', 'Void'].includes(round.phase);
  const busy = (s: { kind: string }) => s.kind === 'signing' || s.kind === 'pending';

  return (
    <InkBox className="p-5 md:p-6" fill="#fff" tilt={-0.4}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="display text-[34px] leading-none">Lock RULE for attempts</h3>
        <ModePicker
          mode={mode}
          onChange={m => {
            setMode(m);
            setTier(null);
            setSelection('upcoming');
          }}
          label="Lock mode"
        />
      </div>
      <p className="mt-2 text-[16px] font-semibold">
        Optional. Without any RULE you still play with the base attempts (Solo 25, Team 50). Locking RULE
        before a round adds attempts for that round; extra attempts still pay the play fee. The RULE comes
        back after the round and is never forfeited. In a Team round every member locks their own RULE, and
        the team gets the sum.
      </p>
      <div className="mt-3">
        <RadioChips
          label="Lock round"
          value={selection}
          onChange={setSelection}
          small
          options={[
            {
              value: 'upcoming' as const,
              label:
                target == null
                  ? 'Reading next round…'
                  : `${modeName(mode)} round ${target} · ${round?.phase === 'Sealing' ? 'Sealing' : 'next slot'}`,
            },
            ...(round && round.roundId !== target
              ? [
                  {
                    value: 'latest' as const,
                    label: `Round ${round.roundId} · ${phaseLabel(round.phase)} (unlock)`,
                  },
                ]
              : []),
          ]}
        />
      </div>
      <p className="mono mt-3 text-[14px] font-bold">
        {selectedId == null
          ? 'Reading the lock target…'
          : `${modeName(mode)} round ${selectedId} · your lock ${formatRule(locked)} RULE`}
      </p>
      <p className="mt-2 font-semibold">
        A new lock applies only to the selected Sealing round or next slot, never to an investigation already
        in progress. Each new round lock pays a storage charge from your play credit.
      </p>
      {tiers.length === 0 ? null : (
        <div className="mt-3">
          <RadioChips
            label="Lock tier"
            value={tier}
            onChange={setTier}
            disabled={!lockable}
            small
            options={tiers.map((t, i) => ({
              value: i,
              label: `${t.name} · ${formatRule(t.amount)} RULE → +${t.extraAttempts}`,
            }))}
          />
        </div>
      )}
      {!lockable ? (
        <p className="mt-3 font-bold">
          This round cannot receive new locks. Select the next slot or Sealing round.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="grape"
          disabled={!lockable || chosen === null}
          busy={busy(actions.lock.state)}
          onClick={() => chosen && actions.lock.run(chosen.amount)}
        >
          Lock RULE
        </Button>
        <Button
          variant="paper"
          disabled={!ended || locked === 0n}
          busy={busy(actions.unlock.state)}
          onClick={() => actions.unlock.run()}
        >
          Unlock after the round
        </Button>
      </div>
      <div className="mt-3 grid gap-3">
        <ActionSlip
          state={actions.lock.state}
          onReset={actions.lock.reset}
          doneText="Lock transfer sent. It settles asynchronously: your lock amount above updates when the chain shows it."
        />
        <ActionSlip
          state={actions.unlock.state}
          onReset={actions.unlock.reset}
          doneText="Unlock sent. The RULE returns asynchronously: your balance updates when the token confirms."
        />
      </div>
      <TokenRegistration />
    </InkBox>
  );
}
