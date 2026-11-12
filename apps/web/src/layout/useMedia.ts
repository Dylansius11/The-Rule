import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches right now, and keeps matching as the viewport changes. False before hydration. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    cb => {
      const mq = matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
