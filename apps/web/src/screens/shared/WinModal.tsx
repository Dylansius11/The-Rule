import { lazy, Suspense, useEffect, useState } from 'react';
import { useSound } from '@/audio';
import { active } from '@/config/env';
import { useCommits, useLatestRound, usePlayer, useWallet } from '@/game';
import { Dialog } from '@/ui/Dialog';
import { correctEvent, loadSeen, nextUnseen, rememberSeen, wonEvent, type WinEvent } from './winEvents';

/** The card is its own chunk: it carries Blot, confetti and the claim bar, which only a winner ever needs. */
const WinCard = lazy(() => import('./WinCard'));

/**
 * The celebration. It watches what the app already polls (the player's own commits and the latest round of each
 * mode) and opens once per commit or round, remembered in localStorage per deployment and account. Events wait
 * their turn when two arrive together. Nothing here is shown for a pending result: a commit must be recorded
 * Correct, a round recorded Settled and Solved, before the modal opens.
 */
export function WinModal() {
  const { accountId } = useWallet();
  const { play } = useSound();
  const player = usePlayer(accountId);
  const teamId = player.data?.teamId ?? null;
  const solo = useLatestRound(0).data ?? null;
  const team = useLatestRound(1).data ?? null;
  const soloCommits = useCommits(0, accountId ? solo?.roundId : null).data;
  const teamCommits = useCommits(1, accountId ? team?.roundId : null).data;
  const [shown, setShown] = useState<WinEvent | null>(null);

  const events = [
    wonEvent(0, solo, accountId, teamId),
    wonEvent(1, team, accountId, teamId),
    correctEvent(0, solo, soloCommits, accountId),
    correctEvent(1, team, teamCommits, accountId),
  ];
  const key = events.map(event => event?.id ?? '-').join('|');
  const scope = `${active.game}:${accountId}`;

  useEffect(() => {
    if (shown || !accountId) return;
    const next = nextUnseen(events, loadSeen(scope));
    if (!next) return;
    rememberSeen(scope, next.id);
    setShown(next);
    if (next.kind === 'correct') window.setTimeout(() => play('correct'), 420);
    // `events` is rebuilt every render; `key` says when its content changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, shown, accountId, scope, play]);

  return (
    <Dialog
      open={shown !== null}
      onClose={() => setShown(null)}
      labelledBy="win-title"
      className="win-dialog"
      openSound="win"
    >
      {shown ? (
        <Suspense fallback={<div className="min-h-[320px]" aria-busy="true" />}>
          <WinCard event={shown} onClose={() => setShown(null)} />
        </Suspense>
      ) : null}
    </Dialog>
  );
}
