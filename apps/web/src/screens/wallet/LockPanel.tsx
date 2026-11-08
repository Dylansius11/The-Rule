import { useState } from 'react';
import { formatRule } from '@/chain/format';
import { useLatestRound, useLock, useLockActions, useParams, useWallet } from '@/game';
import type { Mode } from '@/game/types';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { RadioChips } from '@/ui/Chip';
import { Doodle } from '@/ui/Doodle';
import { InkBox } from '@/ui/InkBox';
import { ModePicker } from '../shared/ModePicker';
import { modeName, phaseLabel } from '../shared/round';

/** Lock RULE for extra attempts in a scheduled round, and register the account for the token. Done means sent, never "locked". */
export function LockPanel() {
  const { accountId } = useWallet();
  const [mode, setMode] = useState<Mode>(0);
  const params = useParams();
  const latest = useLatestRound(mode);
  const round = latest.data ?? null;
  const lockQ = useLock(mode, round?.roundId ?? null, accountId);
  const actions = useLockActions(mode, round?.roundId ?? 0);
  const [tier, setTier] = useState<number | null>(null);
  const tiers = params.data?.lockTiers ?? [];
  const chosen = tier === null ? null : (tiers[tier] ?? null);
  const scheduled = round?.phase === 'Scheduled';
  const locked = lockQ.data ?? 0n;
  const ended = !!round && ['Settled', 'Cancelled', 'Void'].includes(round.phase);
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
          }}
          label="Lock mode"
        />
      </div>
      <p className="mt-2 text-[16px] font-semibold">
        Locking RULE before a round adds attempts (extra attempts still pay the play fee). It comes back after
        the round and is never forfeited.
      </p>
      <p className="mono mt-3 text-[14px] font-bold">
        {round
          ? `${modeName(mode)} round ${round.roundId} · ${phaseLabel(round.phase)} · your lock ${formatRule(locked)} RULE`
          : `No ${modeName(mode).toLowerCase()} round to lock for.`}
      </p>
      {tiers.length === 0 ? null : (
        <div className="mt-3">
          <RadioChips
            label="Lock tier"
            value={tier}
            onChange={setTier}
            disabled={!scheduled}
            small
            options={tiers.map((t, i) => ({
              value: i,
              label: `${formatRule(t.amount)} RULE → +${t.extraAttempts}`,
            }))}
          />
        </div>
      )}
      {!scheduled ? (
        <p className="mt-3 font-bold">
          Locks are accepted only for a scheduled round.{' '}
          {round ? `This one is ${phaseLabel(round.phase).toLowerCase()}.` : ''}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="grape"
          disabled={!scheduled || chosen === null}
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
      <div className="mt-5 flex flex-wrap items-center gap-4 border-t-[3px] border-dashed border-ink/40 pt-4">
        <Doodle name="doodles/key" size={36} />
        <p className="min-w-0 flex-1 font-semibold">
          Minted RULE needs your account registered with the token once.
        </p>
        <Button
          variant="paper"
          size="sm"
          busy={busy(actions.register.state)}
          onClick={() => actions.register.run()}
        >
          Register for RULE
        </Button>
      </div>
      <div className="mt-3">
        <ActionSlip
          state={actions.register.state}
          onReset={actions.register.reset}
          doneText="Registration sent. If you were already registered nothing changes."
        />
      </div>
    </InkBox>
  );
}
