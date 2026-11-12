import { toUiError } from '@/chain/errors';
import { formatNear } from '@/chain/format';
import { useNearBalance, usePlayer, useRuleBalance, useTeam } from '@/game';
import { Art } from '@/art/Art';
import { useConnect } from '@/layout/useConnect';
import { Amount } from '@/ui/Amount';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { Doodle } from '@/ui/Doodle';
import { HashText } from '@/ui/HashText';
import { InkBox } from '@/ui/InkBox';
import { Tag } from '@/ui/Tag';
import { Link } from 'react-router';
import { roomPath } from '@/app/paths';
import { ClaimAll } from '../shared/ClaimAll';
import { ClaimsPanel } from './ClaimsPanel';
import { CreditPanel } from './CreditPanel';
import { LockPanel } from './LockPanel';
import { SessionKeyPanel } from './SessionKeyPanel';
import { TokenRecovery } from './TokenRecovery';
import { PageHead } from '@/screens/shared/PageHead';
import { SetupChecklist } from '@/screens/shared/SetupChecklist';

function Balance({
  label,
  note,
  tilt,
  fill,
  children,
}: {
  label: string;
  note: string;
  tilt: number;
  fill?: string;
  children: React.ReactNode;
}) {
  return (
    <InkBox className="p-4" tilt={tilt} fill={fill}>
      <div className="mono text-[12px] font-bold uppercase tracking-widest">{label}</div>
      <div className="display mt-1 text-[34px] leading-none">{children}</div>
      <p className="mt-2 text-[14px] font-semibold leading-snug text-ink-soft">{note}</p>
    </InkBox>
  );
}

function PendingSlip({ label, active, text }: { label: string; active: boolean; text: string }) {
  return (
    <InkBox className="p-3" radius="slip" fill={active ? 'var(--color-sun)' : '#fff'}>
      <div className="mono text-[12px] font-bold uppercase tracking-widest">{label}</div>
      <p className="mt-1 flex items-center gap-2 font-extrabold">
        {active ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">–</span>}
        {active ? text : 'none'}
      </p>
    </InkBox>
  );
}

/** The account page: wallet NEAR vs game credit vs Team vault, separate pending slips, RULE and locks, claims, token recovery. */
export function AccountPage() {
  const { wallet, connect, busy, error, clear } = useConnect();
  const account = wallet.accountId;
  const near = useNearBalance(account);
  const player = usePlayer(account);
  const rule = useRuleBalance(account);
  const team = useTeam(player.data?.teamId ?? null);

  if (wallet.status === 'loading') {
    return (
      <div className="wrap py-16" aria-busy="true">
        <p className="display text-[40px]">Looking for your wallet…</p>
      </div>
    );
  }
  if (wallet.status !== 'connected' || !account) {
    return (
      <div className="wrap pb-20 pt-7 md:pt-10">
        <PageHead
          title={
            <>
              Your <span className="text-grape">account</span>
            </>
          }
          kicker="your turn"
          note="credit, RULE and claims live here"
          art="stickers/coin"
          artWidth={130}
          underline="doodles/underline-grape"
        />
        {error ? (
          <div className="mt-6">
            <ErrorCard error={error} onRetry={connect} onDismiss={clear} />
          </div>
        ) : null}
        <div className="mt-8">
          <EmptyState
            title="Connect to see your balances"
            art="stickers/pointing"
            artWidth={140}
            actions={
              <Button variant="red" size="lg" onClick={connect} busy={busy}>
                {busy ? 'Connecting…' : 'Connect wallet'}
              </Button>
            }
          >
            Reading is open to everyone. Connecting a testnet wallet lets you add credit, stamp plays, commit
            guesses and claim payouts.
          </EmptyState>
        </div>
      </div>
    );
  }

  const p = player.data;
  return (
    <div className="wrap pb-20 pt-7 md:pt-10">
      <PageHead
        title={
          <>
            Your <span className="text-grape">account</span>
          </>
        }
        kicker="three pots, kept apart"
        note="wallet NEAR, game credit and the team vault are different money"
        art="stickers/coin"
        artWidth={130}
        underline="doodles/underline-grape"
      />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <HashText value={account} kind="account" full label="account" />
        <Tag tone="soft">testnet</Tag>
        <Button variant="paper" size="sm" onClick={() => void wallet.disconnect()}>
          Disconnect
        </Button>
      </div>
      {player.isError ? (
        <div className="mt-5">
          <ErrorCard error={toUiError(player.error)} onRetry={() => void player.refetch()} />
        </div>
      ) : null}

      <SetupChecklist className="mt-7" />

      <section aria-label="Balances" className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Balance
          label="Wallet NEAR"
          tilt={-1.2}
          note="Your account amount. Part may be reserved for storage. Pays gas, never plays."
        >
          {near.isLoading ? (
            '…'
          ) : near.data !== undefined ? (
            <>
              {formatNear(near.data, 3)} <span className="text-[20px]">NEAR</span>
            </>
          ) : (
            '–'
          )}
        </Balance>
        <Balance
          label="Game credit"
          tilt={1}
          fill="var(--color-sun)"
          note="What plays and stakes are paid from. Withdrawn amounts stay reserved until they settle."
        >
          <Doodle name="doodles/coin" size={34} className="float-right" />
          {p ? (
            <>
              {formatNear(p.credit, 3)} <span className="text-[20px]">NEAR</span>
            </>
          ) : player.isLoading ? (
            '…'
          ) : (
            <>
              0 <span className="text-[20px]">NEAR</span>
            </>
          )}
        </Balance>
        <Balance
          label="Team vault"
          tilt={-0.8}
          note={
            p?.teamId != null
              ? 'Your share is tracked by deposit weight on the Team desk.'
              : 'You are not in a team.'
          }
        >
          {p?.teamId != null ? (
            team.data ? (
              <>
                {formatNear(team.data.vault, 3)} <span className="text-[20px]">NEAR</span>
              </>
            ) : (
              '…'
            )
          ) : (
            '–'
          )}
          {p?.teamId != null ? (
            <div className="mt-1 text-[16px]">
              <Link
                to={roomPath(1, 'crew')}
                className="font-sans text-[15px] font-extrabold underline decoration-2"
              >
                Open the crew desk
              </Link>
            </div>
          ) : null}
        </Balance>
        <Balance
          label="RULE balance"
          tilt={1.4}
          fill="var(--color-bubblegum)"
          note="Logged on YES plays; the token confirms each mint separately. No price or value is implied."
        >
          {rule.data !== undefined ? (
            <Amount kind="rule" value={rule.data} className="!text-[28px] font-display" />
          ) : rule.isLoading ? (
            '…'
          ) : (
            '–'
          )}
        </Balance>
      </section>

      <section aria-label="Pending" className="mt-7">
        <h2 className="display text-[40px] leading-none">Pending slips</h2>
        <p className="mb-3 mt-1 font-semibold">
          Things in flight right now; each reads none when nothing is waiting. A pending play is not a
          verdict, and its stake is not available credit.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <PendingSlip
            label="Play"
            active={!!p?.pendingPlay}
            text="A play is waiting for the sealed program."
          />
          <PendingSlip
            label="Checking guesses"
            active={(p?.checkingGuesses ?? 0) > 0}
            text={`${p?.checkingGuesses ?? 0} guess${p?.checkingGuesses === 1 ? '' : 'es'} being checked.`}
          />
          <PendingSlip
            label="Withdrawal"
            active={!!p?.pendingWithdrawal}
            text="Withdrawal sent. Confirmation is pending."
          />
        </div>
      </section>

      <section aria-label="Credit" className="mt-10">
        <h2 className="display mb-4 text-[40px] leading-none">Credit</h2>
        <CreditPanel />
      </section>
      <section aria-label="Session key" className="mt-10">
        <h2 className="display mb-4 text-[40px] leading-none">Session key</h2>
        <SessionKeyPanel />
      </section>
      <section aria-label="RULE and locks" className="mt-10">
        <h2 className="display mb-4 flex items-center gap-3 text-[40px] leading-none">
          <Art name="token/seal" width={44} /> RULE and locks
        </h2>
        <LockPanel />
      </section>
      <section aria-label="Claims" className="mt-10">
        <ClaimAll className="mb-6" />
        <ClaimsPanel />
      </section>
      <section aria-label="Token operation recovery" className="mt-10">
        <details>
          <summary className="display cursor-pointer text-[30px] leading-none">
            Advanced: recover a stuck RULE operation
          </summary>
          <p className="mb-3 mt-2 font-semibold">
            Only needed if a RULE mint or unlock seems stuck. You can ignore this in normal play.
          </p>
          <TokenRecovery />
        </details>
      </section>
    </div>
  );
}
