import { Link } from 'react-router';
import { Art } from '@/art/Art';
import { formatNear } from '@/chain/format';
import { usePlayer, useRuleBalance } from '@/game';
import { useCountUp } from '@/motion/hooks';
import { useReduced } from '@/motion/prefs';
import { Button } from '@/ui/Button';
import { useConnect } from './useConnect';

const ruleNumber = (v: bigint) => Number(v / 10n ** 14n) / 10_000;
const fmtRuleNumber = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Header wallet: credit and RULE balance with the token seal, or a Connect button. */
export function WalletChip() {
  const { wallet, connect, busy } = useConnect();
  const player = usePlayer(wallet.accountId);
  const rule = useRuleBalance(wallet.accountId);
  const reduced = useReduced();
  const counted = useCountUp(rule.data !== undefined ? ruleNumber(rule.data) : 0, reduced);

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
  return (
    <Link
      to="/account"
      className="flex items-center gap-2"
      aria-label={`Account ${wallet.accountId}. Open account page.`}
    >
      <span className="pill hidden xl:inline-flex" title="Game credit, separate from wallet NEAR">
        <b>{player.data ? formatNear(player.data.credit, 3) : '–'}</b> NEAR credit
      </span>
      <span className="pill">
        <Art name="token/seal" width={22} />
        <b>{rule.data !== undefined ? fmtRuleNumber(counted) : '–'}</b>
        <span className="hidden xs:inline">RULE</span>
      </span>
    </Link>
  );
}
