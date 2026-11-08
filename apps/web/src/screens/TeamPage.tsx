import { Link } from 'react-router';
import { toUiError } from '@/chain/errors';
import { usePlayer, useTeam, useWallet } from '@/game';
import { useConnect } from '@/layout/useConnect';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { HashText } from '@/ui/HashText';
import { PageHead } from './shared/PageHead';
import { InTeam } from './team/InTeam';
import { NoTeam } from './team/NoTeam';
import { PastRounds } from './team/PastRounds';

/** S5: the heron's team desk. */
export function TeamPage() {
  const { wallet, connect, busy: connecting, error, clear } = useConnect();
  const { accountId } = useWallet();
  const player = usePlayer(accountId);
  const teamId = player.data?.teamId ?? null;
  const team = useTeam(teamId);

  return (
    <div className="wrap pb-20 pt-8 md:pt-12">
      <PageHead
        title={
          <>
            The team <span className="text-grape">desk</span>
          </>
        }
        kicker="the heron keeps the roster"
        note="one vault, one line, shared luck"
        art="heron/suit"
        artWidth={130}
        underline="doodles/underline-grape"
      />
      {error ? (
        <div className="mt-6">
          <ErrorCard error={error} onRetry={connect} onDismiss={clear} />
        </div>
      ) : null}
      <div className="mt-8 grid gap-8">
        {wallet.status === 'loading' ? (
          <p className="display text-[36px]" aria-busy="true">
            Looking for your wallet…
          </p>
        ) : wallet.status !== 'connected' || !accountId ? (
          <EmptyState
            title="Connect to use the team desk"
            art="stickers/pointing"
            artWidth={130}
            actions={
              <Button variant="red" size="lg" onClick={connect} busy={connecting}>
                Connect wallet
              </Button>
            }
          >
            Teams, vaults and rewards belong to an account. You can still read every Team round on the{' '}
            <Link to="/log?mode=1" className="font-extrabold underline decoration-2">
              ledger
            </Link>
            .
          </EmptyState>
        ) : player.isError ? (
          <ErrorCard error={toUiError(player.error)} onRetry={() => void player.refetch()} />
        ) : player.isLoading || (teamId !== null && team.isLoading) ? (
          <p className="font-bold" aria-busy="true">
            Reading your team…
          </p>
        ) : teamId !== null && team.data ? (
          <>
            <InTeam team={team.data} me={accountId} />
            <HashText value={accountId} kind="account" full label="account" />
          </>
        ) : (
          <NoTeam />
        )}
        {wallet.status === 'connected' ? <PastRounds teamIdGuess={teamId} /> : null}
      </div>
    </div>
  );
}
