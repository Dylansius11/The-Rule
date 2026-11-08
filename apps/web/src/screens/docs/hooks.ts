import { useEffect, useState, useSyncExternalStore } from 'react';
import { activeHeading } from './model';

/** The reading layout (three columns) starts here; below it the page is one column. */
export const WIDE_QUERY = '(min-width: 1280px)';

/** Window event: open the page picker with search focused (small screens have no always-visible field). */
export const OPEN_SEARCH_EVENT = 'docs:search';

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const mq = matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Where an anchor jump lands a heading: the root scroll padding (sticky header) plus the heading's own margin. */
function stickyOffset(id: string): number {
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const el = document.getElementById(id);
  return pad + (el ? parseFloat(getComputedStyle(el).scrollMarginTop) || 0 : 0) + 6;
}

/**
 * Which heading the reader is in: the last one that has scrolled up to the sticky chrome. The distance comes
 * from the page's scroll padding and the heading's own margin, so it matches where an anchor jump lands.
 */
export function useScrollSpy(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join('\n');
  useEffect(() => {
    if (ids.length === 0) {
      setActive(undefined);
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      const tops = ids.flatMap(id => {
        const el = document.getElementById(id);
        return el ? [{ id, top: el.getBoundingClientRect().top }] : [];
      });
      if (tops.length === 0) return;
      const atEnd =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atEnd ? tops[tops.length - 1]!.id : activeHeading(tops, stickyOffset(ids[0]!)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // `key` stands for the id list, which is a fresh array each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/** Set `document.title` while the page is mounted; the previous title comes back when it leaves. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}
