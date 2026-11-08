import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { LiveRegion } from '@/ui/LiveRegion';
import { useDocsOutlet } from './data';
import { docRoute } from './model';
import { highlight, queryTerms, searchDocs, type Segment, type SearchHit } from './search';

interface DocsSearchProps {
  /** `popover` floats the results over the page; `inline` lays them out below the field (inside a sheet). */
  variant?: 'popover' | 'inline';
  /** Bigger field for the home page. */
  large?: boolean;
  /** Focus the field when it mounts (the sheet opened to search). */
  autoFocus?: boolean;
}

function Marked({ parts }: { parts: Segment[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="doc-mark">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

/**
 * Search over the page index, as you type. Keyboard: `/` anywhere in the docs focuses it, arrows move through
 * the results, Enter opens one, Esc closes the list (a second Esc clears the field).
 */
export function DocsSearch({ variant = 'popover', large = false, autoFocus = false }: DocsSearchProps) {
  const { index } = useDocsOutlet();
  const navigate = useNavigate();
  const uid = useId();
  const listId = `${uid}-list`;
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const groups = useMemo(() => searchDocs(index, query), [index, query]);
  const flat = useMemo(() => groups.flatMap(g => g.hits), [groups]);
  const terms = queryTerms(query);
  const showing = open && terms.length > 0;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  function choose(hit: SearchHit | undefined) {
    if (!hit) return;
    setOpen(false);
    setQuery('');
    void navigate(`${docRoute(hit.entry)}${hit.heading ? `#${hit.heading.id}` : ''}`);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (flat.length === 0) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (a + step + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      if (showing && flat.length > 0) {
        e.preventDefault();
        choose(flat[active] ?? flat[0]);
      }
    } else if (e.key === 'Escape') {
      if (showing) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (query) {
        e.preventDefault();
        setQuery('');
      }
    }
  }

  let row = -1;
  return (
    <div
      ref={root}
      className="doc-search relative"
      data-variant={variant}
      onBlur={e => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label className="sr-only" htmlFor={`${uid}-input`}>
        Search the docs
      </label>
      <div className={`doc-search-field ${large ? 'doc-search-large' : ''}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="doc-search-icon">
          <circle cx="10" cy="10" r="6.5" />
          <path d="m15 15 6 6" />
        </svg>
        <input
          id={`${uid}-input`}
          data-docs-search
          data-autofocus={autoFocus ? '' : undefined}
          type="search"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showing && flat.length > 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Search docs"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd className="doc-kbd" aria-hidden="true">
          /
        </kbd>
      </div>

      <LiveRegion
        message={
          terms.length === 0
            ? ''
            : flat.length === 0
              ? 'No pages match.'
              : `${flat.length} result${flat.length === 1 ? '' : 's'}.`
        }
      />

      {showing ? (
        <div className="doc-results" data-variant={variant}>
          {flat.length === 0 ? (
            <p className="doc-noresults">
              No page matches “{query.trim()}”. Try fewer words, or one word from a title.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Search results">
              {groups.map(group => (
                <li key={group.section.id} role="presentation" className="doc-group">
                  <span className="doc-group-label" aria-hidden="true">
                    {group.section.title}
                  </span>
                  <ul role="presentation">
                    {group.hits.map(hit => {
                      const i = ++row;
                      return (
                        <li
                          key={hit.entry.path}
                          id={optionId(i)}
                          role="option"
                          aria-selected={i === active}
                          aria-label={`${group.section.title}: ${hit.entry.title}${hit.heading ? `, ${hit.heading.text}` : ''}`}
                          className="doc-hit"
                          onMouseDown={e => e.preventDefault()}
                          onMouseMove={() => setActive(i)}
                          onClick={() => choose(hit)}
                        >
                          <span className="doc-hit-title">
                            <Marked parts={hit.title} />
                            {hit.heading ? (
                              <span className="doc-hit-heading">
                                {' '}
                                › <Marked parts={highlight(hit.heading.text, terms)} />
                              </span>
                            ) : null}
                          </span>
                          <span className="doc-hit-snippet">
                            <Marked parts={hit.snippet} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
