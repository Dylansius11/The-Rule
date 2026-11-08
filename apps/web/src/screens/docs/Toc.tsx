import { useState } from 'react';
import type { DocHeading } from '@/docs/types';

interface TocProps {
  items: readonly DocHeading[];
  active: string | undefined;
}

function TocList({ items, active, onPick }: TocProps & { onPick?: () => void }) {
  return (
    <ol className="doc-toc-list">
      {items.map(h => (
        <li key={h.id} data-depth={h.depth}>
          <a href={`#${h.id}`} aria-current={active === h.id ? 'location' : undefined} onClick={onPick}>
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** The sticky "On this page" column at 1280 px and up. */
export function TocColumn({ items, active }: TocProps) {
  if (items.length === 0) return null;
  return (
    <nav aria-labelledby="doc-toc-title" className="doc-toc">
      <h2 id="doc-toc-title" className="display">
        On this page
      </h2>
      <TocList items={items} active={active} />
    </nav>
  );
}

/** Below 1280 px the same list folds into a disclosure above the article. */
export function TocDisclosure({ items, active }: TocProps) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <nav aria-label="On this page" className="doc-toc-fold">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="doc-toc-fold-list"
        onClick={() => setOpen(o => !o)}
      >
        <span className="display">On this page</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" data-open={open}>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <div id="doc-toc-fold-list" hidden={!open}>
        <TocList items={items} active={active} onPick={() => setOpen(false)} />
      </div>
    </nav>
  );
}
