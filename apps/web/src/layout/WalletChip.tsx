import { Link } from 'react-router';
import { Art } from '@/art/Art';
import { formatNear } from '@/chain/format';
import { useSound } from '@/audio';
import { usePlayer, useRuleBalance } from '@/game';
import { useCountUp } from '@/motion/hooks';
import { useReduced } from '@/motion/prefs';
import { Button } from '@/ui/Button';
import { useConnect } from './useConnect';

const ruleNumber = (v: bigint) => Number(v / 10n ** 14n) / 10_000;
const fmtRuleNumber = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * Header wallet. Signed out: a Connect button. Connected: the NEAR credit and RULE balances (a link to the account
 * page) and, right beside them, Disconnect: a labelled button on wide screens, a sign-out icon below that. One
 * press signs out, with no menu in between. Chips are compact on phones, where the header has to fit 360 px.
 */
export function WalletChip() {
  const { wallet, connect, busy } = useConnect();
  const player = usePlayer(wallet.accountId);
  const rule = useRuleBalance(wallet.accountId);
  const reduced = useReduced();
  const counted = useCountUp(rule.data !== undefined ? ruleNumber(rule.data) : 0, reduced);
  const { play } = useSound();

  if (wallet.status === 'loading')
    return (
      <span className="pill" aria-busy="true">
        …
      </span>
    );
  if (wallet.status !== 'connected' || !wallet.accountId) {
    return (
      <Button variant="red" size="sm" onClick={connect} busy={busy}>
        {busy ? 'Connecting…' : 'Connect'}
      </Button>
    );
  }
  const credit = player.data ? formatNear(player.data.credit, 3) : '–';
  const disconnect = () => void wallet.disconnect();
  return (
    <div className="flex items-center gap-1.5 md:gap-2">
      <Link
        to="/account"
        className="flex items-center gap-1.5 md:gap-2"
        aria-label={`Account ${wallet.accountId}: ${credit} NEAR game credit, ${rule.data !== undefined ? fmtRuleNumber(counted) : 'unknown'} RULE. Open account page.`}
      >
        <span className="pill" title="Game credit, separate from your wallet's NEAR">
          <b>{credit}</b> NEAR
        </span>
        <span className="pill">
          <Art name="token/seal" width={22} />
          <b>{rule.data !== undefined ? fmtRuleNumber(counted) : '–'}</b>
          <span className="hidden xs:inline">RULE</span>
        </span>
      </Link>
      <button
        type="button"
        className="icon-btn max-md:h-[38px] max-md:w-[38px] xl:hidden"
        aria-label={`Disconnect ${wallet.accountId}`}
        title="Disconnect"
        onClick={() => {
          play('tap');
          disconnect();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </button>
      <div className="hidden xl:block">
        <Button variant="paper" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
