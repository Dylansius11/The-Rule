import { useEffect, useId, useRef, useState } from 'react';
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
 * Header wallet. Signed out: a Connect button. Connected: the NEAR credit and RULE balances as one button that opens
 * a small menu with the account name, a link to the account page and Disconnect, so signing out is one click from
 * anywhere. The chips are compact on phones, where the header has to fit 360 px.
 */
export function WalletChip() {
  const { wallet, connect, busy } = useConnect();
  const player = usePlayer(wallet.accountId);
  const rule = useRuleBalance(wallet.accountId);
  const reduced = useReduced();
  const counted = useCountUp(rule.data !== undefined ? ruleNumber(rule.data) : 0, reduced);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { play } = useSound();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        className="flex items-center gap-1.5 md:gap-2"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Wallet ${wallet.accountId}: ${credit} NEAR game credit, ${rule.data !== undefined ? fmtRuleNumber(counted) : 'unknown'} RULE. Open wallet menu.`}
        onClick={() => {
          play(open ? 'close' : 'open');
          setOpen(o => !o);
        }}
      >
        <span className="pill" title="Game credit, separate from your wallet's NEAR">
          <b>{credit}</b> NEAR
        </span>
        <span className="pill">
          <Art name="token/seal" width={22} />
          <b>{rule.data !== undefined ? fmtRuleNumber(counted) : '–'}</b>
          <span className="hidden xs:inline">RULE</span>
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="group"
          aria-label="Wallet menu"
          className="popover absolute right-0 top-[calc(100%+10px)] z-50 w-[min(300px,calc(100vw-24px))] p-4"
        >
          <p className="font-mono text-[12px] font-bold uppercase tracking-wide text-ink-soft">
            Connected · testnet
          </p>
          <p className="mt-1 break-all text-[17px] font-extrabold">{wallet.accountId}</p>
          <div className="mt-3 grid gap-2.5">
            <Button variant="paper" size="sm" block to="/account" onClick={() => setOpen(false)}>
              Account
            </Button>
            <Button
              variant="red"
              size="sm"
              block
              onClick={() => {
                setOpen(false);
                void wallet.disconnect();
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
