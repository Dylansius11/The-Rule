import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DocEntry, DocsIndex } from '@/docs/types';
import { docRoute } from './model';

interface DocsNavProps {
  index: DocsIndex;
  current: DocEntry | undefined;
  /** Called after a page link is followed (closes the sheet on small screens). */
  onNavigate?: () => void;
}

/**
 * Every section and page, from the index. A section folds shut; the one holding the current page opens by
 * itself and the current page is marked.
 */
export function DocsNav({ index, current, onNavigate }: DocsNavProps) {
  const [shut, setShut] = useState<Record<string, boolean>>({});
  // Following a link into another section opens it.
  useEffect(() => {
    if (current) setShut(s => (s[current.section] ? { ...s, [current.section]: false } : s));
  }, [current]);

  return (
    <nav aria-label="Docs pages" className="doc-nav">
      {index.sections.map(section => {
        const folded = current?.section === section.id ? !!shut[section.id] : shut[section.id] !== false;
        const panel = `doc-nav-${section.id}`;
        return (
          <div key={section.id} className="doc-nav-section">
            <button
              type="button"
              className="doc-nav-toggle"
              aria-expanded={!folded}
              aria-controls={panel}
              onClick={() => setShut(s => ({ ...s, [section.id]: !folded }))}
            >
              <span className="display">{section.title}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true" data-open={!folded}>
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
            <ul id={panel} hidden={folded}>
              {section.entries.map(entry => {
                const here = entry.section === current?.section && entry.slug === current.slug;
                return (
                  <li key={entry.slug}>
                    <Link
                      to={docRoute(entry)}
                      aria-current={here ? 'page' : undefined}
                      className="doc-nav-link"
                      onClick={onNavigate}
                    >
                      {entry.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
