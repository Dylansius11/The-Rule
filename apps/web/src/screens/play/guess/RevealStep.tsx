import { Art } from '@/art/Art';
import { toUiError } from '@/chain/errors';
import { formatNear, shortHash } from '@/chain/format';
import type { useCommits, useGuessActions } from '@/game';
import type { Commit, Round } from '@/game/types';
import { fmtUtc } from '@/screens/shared/format';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';
import { LiveRegion } from '@/ui/LiveRegion';
import { Tag } from '@/ui/Tag';

type Actions = ReturnType<typeof useGuessActions>;
type Commits = ReturnType<typeof useCommits>;

const STATUS_TONE: Record<Commit['status'], 'soft' | 'sun' | 'yes' | 'no' | 'pink'> = {
  Committed: 'sun',
  Checking: 'pink',
  Correct: 'yes',
  Wrong: 'no',
  Refunded: 'soft',
  Unrevealed: 'soft',
};

interface RevealStepProps {
  actions: Actions;
  commits: Commits;
  round: Round | null;
  account: string | null;
}

/** Step 4: open a committed guess so the program can check it, and follow each commit's status. */
export function RevealStep({ actions, commits, round, account }: RevealStepProps) {
  const mine = (commits.data ?? []).filter(c => c.actor === account);
  const sending = actions.reveal.state.kind === 'signing' || actions.reveal.state.kind === 'pending';
  return (
    <div>
      <p className="text-[17px] font-semibold">
        After the minimum delay you open your guess so the sealed program can check it against the rule. Open
        it before the reveal window closes, or half your stake is lost. Commit order decides ties: the
        earliest correct commit wins.
      </p>
      {round?.revealDeadlineMs ? (
        <p className="mono mt-2 text-[14px] font-bold">
          Reveal window closes {fmtUtc(round.revealDeadlineMs)}.
        </p>
      ) : (
        <p className="mono mt-2 text-[14px] font-bold">
          The reveal window opens when plays close. It is not scheduled yet.
        </p>
      )}
      <LiveRegion
        message={actions.reveal.state.kind === 'done' ? 'Guess revealed. The program is checking it.' : ''}
      />
      <h3 className="display mt-5 text-[30px] leading-none">Your commits</h3>
      {account === null ? (
        <p className="mt-2 font-bold">Connect a wallet to see your commits.</p>
      ) : mine.length === 0 ? (
        <div className="mt-2 flex items-center gap-4">
          <Art name="stickers/asleep" width={90} />
          <p className="font-bold">No commits from {account} in this round.</p>
        </div>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {mine.map(c => {
            const saved = actions.saved.find(s => s.commitSeq === c.commitSeq);
            return (
              <li key={c.commitSeq} className="rounded-lg border-[3px] border-ink bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="mono font-bold">commit #{c.commitSeq}</span>
                  <Tag tone={STATUS_TONE[c.status]}>{c.status}</Tag>
                </div>
                <div className="mono mt-1 text-[13px] font-bold">
                  hash {shortHash(c.hash)} · stake {formatNear(c.stake, 3)} NEAR
                </div>
                {c.status === 'Committed' ? (
                  saved ? (
                    <div className="mt-2">
                      <Button
                        variant="grape"
                        size="sm"
                        busy={sending}
                        onClick={() => actions.reveal.run(c.commitSeq)}
                      >
                        Reveal this guess
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-[14px] font-bold text-tomato-deep">
                      The salt for this commit is not on this device, so it cannot be revealed here.
                    </p>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3">
        <ActionSlip
          state={actions.reveal.state}
          doneText="Reveal sent. The sealed program is checking your guess; the status above will change."
          onReset={actions.reveal.reset}
        />
      </div>
      {commits.isError ? (
        <div className="mt-3">
          <ErrorCard error={toUiError(commits.error)} onRetry={() => void commits.refetch()} />
        </div>
      ) : null}
    </div>
  );
}
