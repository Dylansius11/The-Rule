import { useSyncExternalStore } from 'react';

/** Viewport width, in CSS px, from which the guess page puts its "Your guess" summary beside the step card. */
export const WIDE_PX = 1280;
const QUERY = `(min-width: ${WIDE_PX}px)`;

function subscribe(cb: () => void) {
  const mq = matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** True while the viewport is at least 1280 px wide. The summary exists only then, so it is absent (not just hidden) below. */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(QUERY).matches,
    () => false,
  );
}
