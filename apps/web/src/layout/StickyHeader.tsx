import { useEffect, useRef, type ReactNode } from 'react';
import { DeploymentStrip } from './DeploymentStrip';

/**
 * The sticky top of every page: the bar passed in plus the deployment strip. It publishes its real height as
 * `--header-h`, so anything that sticks or scrolls under it (room sub-bar, anchors) never guesses.
 */
export function StickyHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--header-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-30 bg-paper">
      <div
        className="flex items-center gap-2 border-b-[3.5px] border-ink px-3.5 md:gap-4 md:px-7"
        style={{ height: 'var(--header-bar-h)' }}
      >
        {children}
      </div>
      <DeploymentStrip />
    </header>
  );
}
