import { formatNear } from '@/chain/format';
import type { Round } from '@/game/types';

export function Payouts({ round }: { round: Round }) {
  const solved = round.outcome?.kind === 'Solved';
  const part = (n: bigint) => `${formatNear((round.pot * n) / 100n, 3)} NEAR`;
  return (
    <dl className="mono grid gap-2 text-[14px] font-bold sm:grid-cols-2">
      <div>
        <dt className="text-ink-soft">winner</dt>
        <dd className="break-all">
          {round.outcome?.kind === 'Solved' ? round.outcome.account : 'no winner this round'}
        </dd>
      </div>
      <div>
        <dt className="text-ink-soft">pot</dt>
        <dd>{formatNear(round.pot, 3)} NEAR</dd>
      </div>
      <div className="sm:col-span-2 text-ink-soft">
        Published split of the pot:{' '}
        {solved
          ? `winner ${part(40n)}, contributors ${part(40n)}, rollover ${part(10n)}, platform ${part(10n)}`
          : `contributors ${part(40n)}, rollover ${part(50n)}, platform ${part(10n)}`}
        . Claims are pulled from the Wallet page.
      </div>
    </dl>
  );
}
