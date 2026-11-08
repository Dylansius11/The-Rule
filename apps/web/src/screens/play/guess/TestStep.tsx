import type { useLog } from '@/game';
import { Button } from '@/ui/Button';
import { Term } from '@/ui/Term';
import type { GuessDraft } from './useGuessDraft';

type Log = ReturnType<typeof useLog>;

/** Step 2: the free local check of the guess against every play loaded from the chain. Nothing is sent. */
export function TestStep({ draft, log }: { draft: GuessDraft; log: Log }) {
  const { rule, check } = draft;
  return (
    <div>
      <p className="text-[17px] font-semibold">
        Your browser replays your guess against every play in the <Term term="ledger" />. It is free, nothing
        is sent and nothing is charged. A guess that disagrees with even one logged verdict cannot be the
        rule. A guess that agrees with all of them might still not be the rule, because other guesses can fit
        too.
      </p>
      {rule ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button
              variant="paper"
              disabled={!log.complete || check.kind === 'running'}
              busy={check.kind === 'running'}
              onClick={() => void draft.runCheck()}
            >
              Check against the ledger
            </Button>
            <span className="text-[15px] font-bold">
              {log.complete
                ? `${log.rows.length} plays loaded`
                : `Loading the ledger: ${log.loaded} of ${log.total}`}
            </span>
          </div>
          <div aria-live="polite" className="mt-3">
            {check.kind === 'done' ? (
              check.consistent ? (
                <p className="font-extrabold">
                  <span aria-hidden="true">✓ </span>Consistent with all {check.rows} logged verdicts. That
                  does not make it the rule: other guesses can fit too.
                </p>
              ) : (
                <p className="font-extrabold text-tomato-deep">
                  <span aria-hidden="true">✗ </span>Disagrees with {check.mismatches.length} logged verdict
                  {check.mismatches.length === 1 ? '' : 's'} (first at play{' '}
                  {check.mismatches.slice(0, 5).join(', ')}). It cannot be the rule. Go back and change it.
                </p>
              )
            ) : null}
            {check.kind === 'error' ? (
              <p className="font-extrabold text-tomato-deep">
                The local check could not run: {check.message}. Nothing was sent.
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-4 font-bold">Write your guess in step 1 first.</p>
      )}
    </div>
  );
}
