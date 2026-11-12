import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import type { DocEntry, DocHeading, DocsIndex } from '@/docs/types';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { InkBox } from '@/ui/InkBox';
import { LiveRegion } from '@/ui/LiveRegion';
import { BrandGallery } from './BrandGallery';
import { copyMessage, useCopy, useDocsOutlet, useDocText, useTextLoader } from './data';
import { DocsMissing } from './DocsMissing';
import { DocsNav } from './DocsNav';
import { DocsSearch } from './DocsSearch';
import { OPEN_SEARCH_EVENT, useDocumentTitle, useMedia, useScrollSpy, WIDE_QUERY } from './hooks';
import { Markdown } from './Markdown';
import { parseMarkdown } from './parse';
import { DOCS_HOME, docRoute, docTitle, findEntry, findSection, neighbours, tocOf } from './model';
import { TocColumn, TocDisclosure } from './Toc';
import { TrustCallout } from './TrustCallout';

const GALLERY: DocHeading = { depth: 2, text: 'Gallery', id: 'gallery-title' };

/** `/docs/:section/:slug`: the reading layout. An unknown address falls through to the friendly miss. */
export function DocsArticle() {
  const { index } = useDocsOutlet();
  const { section, slug } = useParams();
  const entry = findEntry(index, section, slug);
  // The key restarts focus, scroll spy and copy state for every page.
  return entry ? <Reader key={entry.path} index={index} entry={entry} /> : <DocsMissing />;
}

function Reader({ index, entry }: { index: DocsIndex; entry: DocEntry }) {
  const wide = useMedia(WIDE_QUERY);
  const { hash } = useLocation();
  const section = findSection(index, entry.section);
  const text = useDocText(entry.path);
  const parsed = useMemo(() => (text.data ? parseMarkdown(text.data) : null), [text.data]);
  const hasGallery = entry.section === 'brand' && entry.slug === 'assets';
  const toc = useMemo(() => {
    const items = tocOf(parsed?.headings ?? entry.headings);
    return hasGallery ? [...items, GALLERY] : items;
  }, [parsed, entry.headings, hasGallery]);
  const active = useScrollSpy(parsed ? toc.map(h => h.id) : []);
  const title = useRef<HTMLHeadingElement>(null);
  const { prev, next } = neighbours(index, entry);

  useDocumentTitle(docTitle(entry.title, section?.title, 'Docs'));
  useEffect(() => title.current?.focus({ preventScroll: true }), []);

  // A deep link to a heading scrolls once the text has been drawn. Later hash changes (TOC, anchors) scroll natively.
  const landing = useRef(hash);
  useEffect(() => {
    if (!parsed || !landing.current) return;
    document
      .getElementById(decodeURIComponent(landing.current.slice(1)))
      ?.scrollIntoView({ block: 'start', behavior: 'instant' });
    landing.current = '';
  }, [parsed]);

  return (
    <div className="doc-page">
      {wide ? null : <DocsBar index={index} entry={entry} />}
      <div className="wrap doc-shell">
        {wide ? (
          <aside className="doc-side" aria-label="Docs navigation">
            <DocsSearch />
            <div className="doc-side-scroll">
              <DocsNav index={index} current={entry} />
            </div>
          </aside>
        ) : null}

        <article className="doc-article" aria-labelledby="doc-title">
          <header className="doc-head">
            <nav aria-label="Breadcrumb" className="doc-crumbs">
              <ol>
                <li>
                  <Link to={DOCS_HOME}>Docs</Link>
                </li>
                <li>
                  <Link to={`${DOCS_HOME}#section-${entry.section}`}>{section?.title ?? entry.section}</Link>
                </li>
              </ol>
            </nav>
            <h1 id="doc-title" ref={title} tabIndex={-1} className="doc-title display">
              {entry.title}
            </h1>
            <p className="doc-summary">{entry.summary}</p>
            <PageActions entry={entry} />
          </header>

          {entry.section === 'trust' ? <TrustCallout /> : null}
          {wide ? null : <TocDisclosure items={toc} active={active} />}

          <div className="doc-prose">
            {parsed ? (
              <Markdown blocks={parsed.blocks} />
            ) : text.isError ? (
              <InkBox fill="#fff4f1" role="alert" className="p-5">
                <p className="display text-[32px] leading-none text-tomato-deep">This page did not load</p>
                <p className="mt-2 font-bold">
                  The Markdown file could not be fetched. Nothing else changed.
                </p>
                <div className="mt-3">
                  <Button variant="red" size="sm" onClick={() => void text.refetch()}>
                    Try again
                  </Button>
                </div>
              </InkBox>
            ) : (
              <div className="doc-skeleton" aria-busy="true" role="status">
                <span className="sr-only">Loading the page…</span>
                <i />
                <i />
                <i />
                <i />
              </div>
            )}
          </div>

          {parsed && hasGallery ? <BrandGallery /> : null}

          <nav aria-label="Previous and next page" className="doc-pager">
            {prev ? (
              <Link to={docRoute(prev)} rel="prev" className="doc-pager-link" data-dir="prev">
                <span className="doc-pager-kicker">← Previous</span>
                <span className="doc-pager-title">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={docRoute(next)} rel="next" className="doc-pager-link" data-dir="next">
                <span className="doc-pager-kicker">Next →</span>
                <span className="doc-pager-title">{next.title}</span>
              </Link>
            ) : null}
          </nav>
        </article>

        {wide ? <TocColumn items={toc} active={active} /> : null}
      </div>
    </div>
  );
}

/** Copy the page's raw Markdown, or open the raw file. A failed copy says so. */
function PageActions({ entry }: { entry: DocEntry }) {
  const load = useTextLoader();
  const { state, busy, copy } = useCopy();
  return (
    <div className="doc-actions">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="paper"
          size="sm"
          busy={busy}
          onClick={() => void copy('this page as Markdown', () => load(entry.path))}
        >
          {state.kind === 'ok' ? 'Copied ✓' : 'Copy page as Markdown'}
        </Button>
        <Button variant="paper" size="sm" href={entry.path}>
          Open raw .md
        </Button>
      </div>
      <p
        className={`doc-status ${state.kind === 'error' ? 'doc-status-error' : ''}`}
        data-testid="copy-status"
      >
        {copyMessage(state)}
      </p>
      <LiveRegion message={copyMessage(state)} assertive={state.kind === 'error'} />
    </div>
  );
}

/** Below 1280 px: a sticky bar naming the page; it opens the page picker and search as a sheet. */
function DocsBar({ index, entry }: { index: DocsIndex; entry: DocEntry }) {
  const [open, setOpen] = useState(false);
  const [searchFirst, setSearchFirst] = useState(false);
  const { pathname } = useLocation();
  const section = findSection(index, entry.section);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onSearch = () => {
      setSearchFirst(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onSearch);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onSearch);
  }, []);

  return (
    <>
      <div className="doc-bar" data-docs-bar>
        <button
          type="button"
          className="doc-bar-main"
          aria-haspopup="dialog"
          onClick={() => {
            setSearchFirst(false);
            setOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span className="min-w-0">
            <span className="doc-bar-kicker">Docs · {section?.title ?? entry.section}</span>
            <span className="doc-bar-title">{entry.title}</span>
          </span>
        </button>
        <button
          type="button"
          className="doc-bar-search"
          aria-haspopup="dialog"
          aria-label="Search the docs"
          onClick={() => {
            setSearchFirst(true);
            setOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10" cy="10" r="6.5" />
            <path d="m15 15 6 6" />
          </svg>
        </button>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} labelledBy="docs-menu-title" kind="sheet">
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="docs-menu-title" className="display text-[34px]">
              Docs
            </h2>
            <button
              type="button"
              className="grid min-h-[44px] min-w-[44px] place-items-center rounded-full border-[3px] border-ink bg-sun font-display text-[22px] font-black"
              onClick={() => setOpen(false)}
              aria-label="Close"
              data-autofocus={searchFirst ? undefined : ''}
            >
              ✕
            </button>
          </div>
          <div className="mb-4">
            <DocsSearch variant="inline" autoFocus={searchFirst} />
          </div>
          <DocsNav index={index} current={entry} onNavigate={() => setOpen(false)} />
        </div>
      </Dialog>
    </>
  );
}
