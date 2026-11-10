import { formatNear } from '@/chain/format';
import { SESSION_ALLOWANCE } from '@/chain/session/policy';
import { useSessionKey } from '@/chain/session/useSessionKey';
import { useWallet } from '@/game';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { Tag } from '@/ui/Tag';

const TAG = {
  unsupported: { tone: 'soft', label: 'Not available' },
  off: { tone: 'soft', label: 'Off' },
  checking: { tone: 'soft', label: 'Checking' },
  active: { tone: 'yes', label: 'Active' },
  low: { tone: 'sun', label: 'Allowance low' },
} as const;

type Session = ReturnType<typeof useSessionKey>;

/**
 * One wallet approval grants a key that signs plays and guesses without a popup. This view shows its
 * real on-chain state, never a guess, and the two actions that need the wallet: enable and revoke.
 */
export function SessionKeyView({ session, connected }: { session: Session; connected: boolean }) {
  const tag = TAG[session.status];
  const usable = session.status === 'active' || session.status === 'low';

  if (!connected) {
    return (
      <InkBox className="p-5" fill="#fff" tilt={-0.4}>
        <p className="font-semibold">
          Connect a wallet first. One approval can then grant a key that signs plays and guesses without a
          popup.
        </p>
      </InkBox>
    );
  }

  return (
    <InkBox className="p-5 md:p-6" fill="#fff" tilt={-0.4}>
      <div className="flex flex-wrap items-center gap-3">
        <Tag tone={tag.tone}>{tag.label}</Tag>
        {usable && session.allowance !== null ? (
          <span className="mono text-[14px] font-bold">
            {formatNear(session.allowance, 3)} of {formatNear(SESSION_ALLOWANCE, 1)} NEAR gas allowance left
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-[16px] font-semibold" role="status" aria-live="polite">
        {usable
          ? session.status === 'low'
            ? 'The key is nearly out of gas allowance. Renew it with one approval before it stops mid-round.'
            : 'Plays, guesses and claims sign in this browser. No wallet popup for those.'
          : (session.reason ?? 'Checking the key on-chain…')}
      </p>

      <ul className="mt-3 grid gap-1 text-[15px] font-semibold">
        <li>
          The key can spend your in-game credit on plays and guesses and use its gas allowance. It cannot
          withdraw NEAR or move RULE.
        </li>
        <li>
          Deposits, withdrawals, locks and token actions always ask your wallet. So does any action the key
          cannot sign.
        </li>
        <li>
          It lives in this browser as a non-extractable key and is deleted when you sign out. Revoking removes
          it from your account too.
        </li>
      </ul>

      {session.status !== 'unsupported' ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant={usable && session.status !== 'low' ? 'paper' : 'red'}
            busy={session.busy}
            disabled={session.busy || session.status === 'checking'}
            onClick={() => void session.enable()}
          >
            {usable ? 'Renew the key (one approval)' : 'Enable session key (one approval)'}
          </Button>
          {usable ? (
            <Button variant="paper" disabled={session.busy} onClick={() => void session.revoke()}>
              Revoke the key (one approval)
            </Button>
          ) : null}
          {session.publicKey ? (
            <Button variant="paper" disabled={session.busy} onClick={() => void session.refresh()}>
              Check allowance
            </Button>
          ) : null}
        </div>
      ) : null}
    </InkBox>
  );
}

export function SessionKeyPanel() {
  const wallet = useWallet();
  const session = useSessionKey();
  return <SessionKeyView session={session} connected={wallet.status === 'connected'} />;
}
