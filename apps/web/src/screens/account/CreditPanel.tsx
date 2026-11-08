import { useState } from 'react';
import { formatNear } from '@/chain/format';
import { useCreditActions, usePlayer, useWallet } from '@/game';
import { ActionSlip } from '@/ui/ActionSlip';
import { AmountField, readNear } from '@/ui/AmountField';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { Art } from '@/art/Art';

/** Deposit and withdraw game credit. A withdrawal is "sent" until the player flag clears; never "withdrawn" from the transaction alone. */
export function CreditPanel() {
  const { accountId } = useWallet();
  const player = usePlayer(accountId);
  const { deposit, withdraw } = useCreditActions();
  const [dep, setDep] = useState('');
  const [wd, setWd] = useState('');
  const d = readNear(dep);
  const w = readNear(wd);
  const credit = player.data?.credit ?? 0n;
  const wdError =
    w.error ??
    (w.amount !== null && w.amount > credit
      ? `More than your game credit (${formatNear(credit, 4)} NEAR).`
      : null);
  const wdPending = !!player.data?.pendingWithdrawal;
  const depBusy = deposit.state.kind === 'signing' || deposit.state.kind === 'pending';
  const wdBusy = withdraw.state.kind === 'signing' || withdraw.state.kind === 'pending';

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <InkBox className="p-5" fill="#fff" tilt={-0.6}>
        <div className="flex items-center gap-3">
          <Art name="stickers/coin" width={64} />
          <h3 className="display text-[34px] leading-none">Add credit</h3>
        </div>
        <p className="mb-3 mt-2 text-[16px] font-semibold">
          Plays and stakes are paid from game credit, because function-call keys cannot attach NEAR.
        </p>
        <AmountField label="Deposit" value={dep} onChange={setDep} error={d.error} disabled={depBusy} />
        <div className="mt-3">
          <Button
            variant="red"
            disabled={d.amount === null}
            busy={depBusy}
            onClick={() => d.amount !== null && deposit.run(d.amount)}
          >
            Deposit credit
          </Button>
        </div>
        <div className="mt-3">
          <ActionSlip
            state={deposit.state}
            onReset={deposit.reset}
            doneText="Deposit transaction accepted. Your game credit above updates when the chain shows it."
          />
        </div>
      </InkBox>

      <InkBox className="p-5" fill="#fff" tilt={0.6}>
        <h3 className="display text-[34px] leading-none">Withdraw credit</h3>
        <p className="mb-3 mt-2 text-[16px] font-semibold">
          Needs a full-access key; it attaches 1 yoctoNEAR. The transfer to your wallet is a separate step
          that can take a moment.
        </p>
        <AmountField
          label="Withdraw"
          value={wd}
          onChange={setWd}
          error={wdError}
          disabled={wdBusy || wdPending}
        />
        <div className="mt-3">
          <Button
            variant="paper"
            disabled={w.amount === null || !!wdError || wdPending}
            busy={wdBusy}
            onClick={() => w.amount !== null && withdraw.run(w.amount)}
          >
            Withdraw credit
          </Button>
        </div>
        <div className="mt-3">
          <ActionSlip
            state={withdraw.state}
            onReset={withdraw.reset}
            doneText="Withdrawal sent, waiting for the transfer. The withdrawn amount stays reserved and is not available credit until it settles."
          />
        </div>
        {wdPending ? (
          <p className="mt-3 flex items-start gap-3 font-extrabold" role="status">
            <span className="spinner mt-0.5" aria-hidden="true" />
            Withdrawal sent, waiting for the transfer. Do not retry. This clears on its own.
          </p>
        ) : withdraw.state.kind === 'done' ? (
          <p className="mt-3 font-bold" role="status">
            No withdrawal is pending now. Compare your wallet NEAR and game credit to see where the amount
            ended up.
          </p>
        ) : null}
      </InkBox>
    </div>
  );
}
