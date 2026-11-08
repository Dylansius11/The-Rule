import { roomPath } from '@/app/paths';
import { toUiError } from '@/chain/errors';
import { useLatestRound } from '@/game';
import type { Mode } from '@/game/types';
import { RoundStrip } from '@/screens/shared/RoundStrip';
import { isActive, modeName } from '@/screens/shared/round';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';

const BLURB: Record<Mode, string> = {
  0: 'You against the law. Your own credit, your own line.',
  1: 'Your crew plays as one. A shared vault, one line.',
};

function ModeColumn({ mode }: { mode: Mode }) {
  const q = useLatestRound(mode);
  return (
    <div className="min-w-0">
      <h3 className="display text-[clamp(40px,5vw,60px)] leading-none">{modeName(mode)}</h3>
      <p className="mb-4 mt-1 text-[17px] font-bold">{BLURB[mode]}</p>
      {q.isError ? (
        <ErrorCard error={toUiError(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <RoundStrip mode={mode} round={q.data ?? null} loading={q.isLoading} />
      )}
      <div className="mt-6">
        <Button to={roomPath(mode)} variant={mode === 0 ? 'red' : 'grape'}>
          Enter {modeName(mode)}
        </Button>
      </div>
    </div>
  );
}

/** Both modes, side by side, straight from the chain. The heading says "live" only when a round is open. */
export function LiveStrip() {
  const live = isActive(useLatestRound(0).data) || isActive(useLatestRound(1).data);
  return (
    <div className="wrap">
      <div className="mb-8">
        <h2 className="display text-[clamp(44px,7vw,84px)] leading-[0.85]">
          {live ? (
            <>
              Live <span className="text-tomato">right now</span>
            </>
          ) : (
            <>
              The latest <span className="text-tomato">rounds</span>
            </>
          )}
        </h2>
        <p className="hand -rotate-1 text-[24px] md:text-[28px]">two rounds, every day, side by side.</p>
      </div>
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <ModeColumn mode={0} />
        <ModeColumn mode={1} />
      </div>
      <p className="mt-8 text-[15px] font-semibold">
        Numbers come straight from the chain. Each mode has its own rule, pot, ledger and season board.
      </p>
    </div>
  );
}
