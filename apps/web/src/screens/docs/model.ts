import { DOCS_PATH } from '@/app/paths';
import type { DocEntry, DocHeading, DocSection, DocsIndex } from '@/docs/types';

/** The docs home route. */
export const DOCS_HOME = DOCS_PATH;

/** One-line description per section, shown on the home cards. A section without an entry shows none. */
export const SECTION_BLURB: Record<string, string> = {
  play: 'Stamp a play, read the ledger, write a guess and see what a round costs and pays.',
  agents: 'Read-only views, contract calls, a solver loop and the safety rules for bots.',
  trust: 'Who is trusted for what, how to verify a round, and what replay does not prove.',
  rule: 'The testnet play-money token: how it mints and what locking it does today.',
  brand: 'Characters, art inventory, colour and type, and how to work with us.',
};

/** The route (not the raw Markdown file) of a docs page. */
export const docRoute = (entry: Pick<DocEntry, 'section' | 'slug'>): string =>
  `${DOCS_HOME}/${entry.section}/${entry.slug}`;

/** Every page in reading order: sections in index order, then each section's entries. */
export function flatten(index: DocsIndex): DocEntry[] {
  return index.sections.flatMap(section => section.entries);
}

export function findEntry(
  index: DocsIndex,
  section: string | undefined,
  slug: string | undefined,
): DocEntry | undefined {
  return index.sections.find(s => s.id === section)?.entries.find(e => e.slug === slug);
}

export function findSection(index: DocsIndex, id: string | undefined): DocSection | undefined {
  return index.sections.find(s => s.id === id);
}

/** Previous and next page in reading order; the ends of the whole docs have one neighbour only. */
export function neighbours(
  index: DocsIndex,
  entry: DocEntry,
): { prev: DocEntry | undefined; next: DocEntry | undefined } {
  const all = flatten(index);
  const at = all.findIndex(e => e.section === entry.section && e.slug === entry.slug);
  if (at === -1) return { prev: undefined, next: undefined };
  return { prev: all[at - 1], next: all[at + 1] };
}

/** Headings the "On this page" list shows: h2 and h3. */
export function tocOf(headings: readonly DocHeading[]): DocHeading[] {
  return headings.filter(h => h.depth === 2 || h.depth === 3);
}

/**
 * Scroll spy: the id of the last heading that has reached `offset` px from the top of the viewport. Before the
 * first heading it is the first one; with no headings, undefined.
 */
export function activeHeading(
  tops: readonly { id: string; top: number }[],
  offset: number,
): string | undefined {
  let current = tops[0]?.id;
  for (const h of tops) {
    if (h.top <= offset) current = h.id;
    else break;
  }
  return current;
}

/** `document.title` for a docs page: most specific part first. */
export function docTitle(...parts: (string | undefined)[]): string {
  return [...parts.filter((p): p is string => !!p), 'THE RULE'].join(' · ');
}

/** Human size of a text: bytes of its UTF-8 encoding in kB with one decimal, e.g. `47.5 kB`. */
export function kilobytes(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return `${(bytes / 1024).toFixed(1)} kB`;
}
