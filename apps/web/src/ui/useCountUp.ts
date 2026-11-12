import { useEffect, useRef, useState } from 'react';
import { useReduced } from '@/motion/prefs';

/** The value `t` (0..1) of the way from `from` to `to`, eased out. Exact at both ends, any bigint size. */
export function stepValue(from: bigint, to: bigint, t: number): bigint {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const eased = 1 - (1 - t) ** 3;
  return from + ((to - from) * BigInt(Math.round(eased * 10_000))) / 10_000n;
}

/**
 * Shows `target`, and when it changes after the first render counts from what was on screen to the new value.
 * It does not animate on mount, so a page opens on the real number, unless `rise` asks the first render to count
 * up from zero for a value that has just been earned. Under reduced motion it jumps straight there. The result
 * is always the recorded value once the count ends: it decorates a change, it never invents one.
 */
export function useCountUp(target: bigint, ms = 700, rise = false): bigint {
  const reduced = useReduced();
  const [shown, setShown] = useState(rise ? 0n : target);
  const current = useRef(shown);

  useEffect(() => {
    const start = current.current;
    if (reduced || start === target) {
      current.current = target;
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / ms);
      current.current = stepValue(start, target, t);
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, ms]);

  return shown;
}
