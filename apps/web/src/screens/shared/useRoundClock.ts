import { useEffect, useState } from 'react';
import type { Round } from '@/game/types';
import { useNow } from '@/motion/hooks';
import { playsOpen, roundClock, type RoundClock } from './clock';

/** The round's countdown, ticking once a second only while a deadline can still pass. */
export function useRoundClock(round: Round | null | undefined): RoundClock {
  const ticking = !!round && (round.phase === 'Investigation' || round.phase === 'Reveal');
  return roundClock(round, useNow(1000, ticking));
}

/**
 * Whether plays and commits are open right now. Flips once, exactly when the deadline passes, so desks swap
 * to the closed state without a polling interval or a stale "plays open" label.
 */
export function usePlaysOpen(round: Round | null | undefined): boolean {
  const [now, setNow] = useState(() => Date.now());
  const end = round?.phase === 'Investigation' ? round.investigationEndMs : null;
  useEffect(() => {
    if (end === null) return;
    const wait = end - Date.now();
    if (wait <= 0) {
      setNow(Date.now());
      return;
    }
    // A timer may fire a hair early; the effect re-arms until the clock really passes the deadline.
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait + 25, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [end, now]);
  return playsOpen(round, now);
}
