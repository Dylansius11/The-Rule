import { Art } from '@/art/Art';
import { formatNear } from '@/chain/format';
import type { useGuessActions } from '@/game';
import { useConnect } from '@/layout/useConnect';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { Doodle } from '@/ui/Doodle';
import { Term } from '@/ui/Term';
import type { GuessDraft } from './useGuessDraft';

type Actions = ReturnType<typeof useGuessActions>;

interface CommitStepProps {
  draft: GuessDraft;
  actions: Actions;
  /** The round is taking plays and commits. */
  open: boolean;
  /** Stake locked at commit, once params are read. */
  stake: bigint | null;
  /** Team mode and the connected account has no team yet. */
  needsTeam: boolean;
}

/** Step 2: the stake quote and the commit. A wallet is asked for here, at the moment of action, not before. */
export function CommitStep({ draft, actions, open, stake, needsTeam }: CommitStepProps) {
  const { wallet, connect, busy } = useConnect();
  const { rule } = draft;
  return (
    <div>
      <p className="text-[17px] font-semibold">
        <Term term="commit">Committing</Term> seals your guess as a hash on the chain and locks a{' '}
        <Term term="stake" />. Nobody can read the guess until you <Term term="reveal" /> it in step 3. The
        earliest correct commit wins 40% of the pot.
      </p>
      <h3 className="display mt-4 flex items-center gap-2 text-[30px] leading-none">
        Commit <Doodle name="doodles/ribbon" size={60} rot={-4} />
      </h3>
      <p className="mt-2 text-[16px] font-semibold">
        {stake !== null ? (
          <>
            Stake locked at commit: <b className="mono">{formatNear(stake, 3)} NEAR</b>. Correct returns it;
            wrong or unrevealed returns half and the other half joins the pot.
          </>
        ) : (
          'Reading the stake from the contract…'
        )}
      </p>
      <p className="mt-1 text-[15px] font-bold">
        The <Term term="salt" /> for this guess is stored only in this browser. Do not clear site data before
        you reveal.
      </p>
      {rule ? (
        <p className="mt-3 rounded-lg border-[3px] border-ink bg-paper-2 p-3 text-[17px] font-extrabold">
          {draft.text ? draft.text.english : 'Your guess'}
        </p>
      ) : (
        <p className="mt-3 font-bold">Write your guess in step 1 first.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {wallet.status !== 'connected' ? (
          <>
            <Art name="stickers/pointing" width={70} />
            <div className="min-w-0 flex-1">
              <p className="mb-2 font-extrabold">Your turn. Connect a testnet wallet to commit.</p>
              <Button variant="red" size="lg" onClick={connect} busy={busy || wallet.status === 'loading'}>
                {busy ? 'Connecting…' : 'Connect wallet'}
              </Button>
            </div>
          </>
        ) : needsTeam ? (
          <p className="font-extrabold">
            A team commits as one. Start or join a team on the Stamp tab first, then come back.
          </p>
        ) : (
          <Button
            variant="red"
            size="lg"
            disabled={!rule || !open || !stake}
            busy={actions.commit.state.kind === 'signing' || actions.commit.state.kind === 'pending'}
            onClick={() => rule && actions.commit.run(rule)}
            sound="seal"
          >
            Seal &amp; commit
          </Button>
        )}
        {!open && wallet.status === 'connected' ? (
          <span className="font-bold">Commits are closed: no round is taking plays.</span>
        ) : null}
      </div>
      <div className="mt-4 flex items-start gap-3">
        {actions.commit.state.kind === 'done' ? (
          <Art name="stickers/envelope" width={84} className="shrink-0" />
        ) : null}
        <div className="min-w-0 flex-1">
          <ActionSlip
            state={actions.commit.state}
            doneText="Committed. Your guess is a hash on chain now. Reveal it in step 3 after the minimum delay."
            onReset={actions.commit.reset}
          />
        </div>
      </div>
    </div>
  );
}
