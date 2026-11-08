import { toUiError } from '@/chain/errors';
import { formatNear } from '@/chain/format';
import {
  useLockActions,
  usePlayer,
  useTokenState,
  useTokenStorage,
  useTokenStorageMinimum,
  useWallet,
} from '@/game';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';

/** NEP-145 storage payment and the game's read-only registration check are separate signatures. */
export function TokenRegistration() {
  const { accountId } = useWallet();
  const player = usePlayer(accountId);
  const storage = useTokenStorage(accountId);
  const minimum = useTokenStorageMinimum();
  const token = useTokenState(accountId);
  const actions = useLockActions(0, 0);
  const busy = (s: { kind: string }) => s.kind === 'signing' || s.kind === 'pending';
  const error = storage.error ?? minimum.error ?? token.error;
  return (
    <section className="mt-5 border-t-[3px] border-dashed border-ink/40 pt-4" aria-label="RULE registration">
      <h4 className="font-extrabold">Register for RULE</h4>
      <p className="mt-2 font-semibold">
        First pay token storage from your wallet, then let the game check the registration. These are separate
        actions; neither spends play credit.
      </p>
      {error ? (
        <ErrorCard
          error={toUiError(error)}
          onRetry={() => {
            void storage.refetch();
            void minimum.refetch();
            void token.refetch();
          }}
        />
      ) : null}
      <p className="mt-2 font-bold" role="status">
        {error
          ? 'Could not read token registration. Check again before signing.'
          : token.data === 'registered'
            ? 'RULE registration confirmed by the game.'
            : token.data === 'pending'
              ? 'The game is checking your token registration…'
              : storage.data
                ? 'Token storage registered. Confirm it with the game next.'
                : storage.isPending || minimum.isPending
                  ? 'Reading token storage…'
                  : 'Token storage is not registered yet.'}
      </p>
      {!player.data ? (
        <p className="mt-2 font-bold">Deposit play credit first to create your game player account.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          variant="paper"
          size="sm"
          disabled={
            !accountId || minimum.data == null || !!storage.data || storage.isPending || storage.isError
          }
          busy={busy(actions.storage.state)}
          onClick={() => minimum.data != null && actions.storage.run(minimum.data)}
        >
          Pay token storage{minimum.data != null ? ` · ${formatNear(minimum.data, 24)} NEAR` : ''}
        </Button>
        <Button
          variant="paper"
          size="sm"
          disabled={!storage.data || !player.data || token.data === 'pending' || token.data === 'registered'}
          busy={busy(actions.register.state)}
          onClick={() => actions.register.run()}
        >
          Confirm RULE registration
        </Button>
      </div>
      <div className="mt-3 grid gap-3">
        <ActionSlip
          state={actions.storage.state}
          onReset={actions.storage.reset}
          doneText="Storage deposit submitted. The token storage status above updates when the chain confirms it."
        />
        <ActionSlip
          state={actions.register.state}
          onReset={actions.register.reset}
          doneText="Registration check submitted. Only the game status above confirms registration."
        />
      </div>
    </section>
  );
}
