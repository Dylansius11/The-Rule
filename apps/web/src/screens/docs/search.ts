import type { DocEntry, DocHeading, DocSection, DocsIndex } from '@/docs/types';

export interface Segment {
  text: string;
  hit: boolean;
}

export interface SearchHit {
  entry: DocEntry;
  score: number;
  /** The best matching heading, when one matches. */
  heading: DocHeading | undefined;
  title: Segment[];
  snippet: Segment[];
}

export interface SearchGroup {
  section: DocSection;
  hits: SearchHit[];
}

const SNIPPET = 150;

/** Lower-cased search words, at most six. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(Boolean),
    ),
  ].slice(0, 6);
}

/** A word also matches without a trailing plural `s`, so "attempts" finds "attempt". */
function variants(term: string): string[] {
  return term.length > 3 && term.endsWith('s') ? [term, term.slice(0, -1)] : [term];
}

const has = (text: string, term: string) => variants(term).some(v => text.includes(v));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split `text` into plain and highlighted runs for the given terms. */
export function highlight(text: string, terms: readonly string[]): Segment[] {
  const words = [...new Set(terms.flatMap(variants))].sort((a, b) => b.length - a.length);
  if (words.length === 0 || text === '') return [{ text, hit: false }];
  const pattern = new RegExp(words.map(escape).join('|'), 'giu');
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

/** A window of `plain` around the first match, cut at word edges, with the terms highlighted. */
export function snippetOf(source: string, terms: readonly string[], width = SNIPPET): Segment[] {
  // The index keeps a table's `---` delimiter row as text; it is noise in a snippet.
  const plain = source
    .replace(/(?:^|\s)-{3,}(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = plain.toLowerCase();
  let at = -1;
  for (const term of terms) {
    for (const v of variants(term)) {
      const found = lower.indexOf(v);
      if (found !== -1 && (at === -1 || found < at)) at = found;
    }
  }
  if (at === -1)
    return highlight(plain.length > width ? `${plain.slice(0, width).trimEnd()}…` : plain, terms);
  let start = Math.max(0, at - Math.floor(width * 0.35));
  if (start > 0) {
    const space = plain.indexOf(' ', start);
    start = space === -1 || space > at ? start : space + 1;
  }
  let end = Math.min(plain.length, start + width);
  if (end < plain.length) {
    const space = plain.lastIndexOf(' ', end);
    end = space > at ? space : end;
  }
  const body = plain.slice(start, end).trim();
  return highlight(`${start > 0 ? '…' : ''}${body}${end < plain.length ? '…' : ''}`, terms);
}

function bestHeading(headings: readonly DocHeading[], terms: readonly string[]): DocHeading | undefined {
  let best: { heading: DocHeading; score: number } | undefined;
  for (const heading of headings) {
    const text = heading.text.toLowerCase();
    const score = terms.filter(t => has(text, t)).length;
    if (score > 0 && (!best || score > best.score)) best = { heading, score };
  }
  return best?.heading;
}

function score(entry: DocEntry, terms: readonly string[], phrase: string): number | null {
  const title = entry.title.toLowerCase();
  const summary = entry.summary.toLowerCase();
  const plain = entry.plain.toLowerCase();
  const heads = entry.headings.map(h => h.text.toLowerCase());
  let total = 0;
  for (const term of terms) {
    const inTitle = has(title, term);
    const inHeading = heads.some(h => has(h, term));
    const inSummary = has(summary, term);
    const inPlain = has(plain, term);
    if (!inTitle && !inHeading && !inSummary && !inPlain) return null;
    if (inTitle) total += title.startsWith(term) ? 40 : 30;
    if (inHeading) total += 15;
    if (inSummary) total += 8;
    if (inPlain) {
      const count = variants(term).reduce((n, v) => n + plain.split(v).length - 1, 0);
      total += 3 + Math.min(count, 5);
    }
  }
  if (terms.length > 1) {
    if (title.includes(phrase)) total += 20;
    if (heads.some(h => h.includes(phrase))) total += 15;
    if (plain.includes(phrase)) total += 10;
  }
  return total;
}

/**
 * Client-side search over the docs index: every word must appear in a page's title, summary, headings or text.
 * Best match first inside each section; the section with the best match comes first.
 */
export function searchDocs(index: DocsIndex, query: string, limit = 24): SearchGroup[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const phrase = terms.join(' ');
  const hits: (SearchHit & { order: number })[] = [];
  let order = 0;
  for (const section of index.sections) {
    for (const entry of section.entries) {
      const s = score(entry, terms, phrase);
      order++;
      if (s === null) continue;
      hits.push({
        entry,
        score: s,
        order,
        heading: bestHeading(entry.headings, terms),
        title: highlight(entry.title, terms),
        snippet: snippetOf(entry.plain, terms),
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  const kept = hits.slice(0, limit);
  const groups: SearchGroup[] = [];
  for (const hit of kept) {
    const section = index.sections.find(s => s.id === hit.entry.section);
    if (!section) continue;
    const group = groups.find(g => g.section.id === section.id);
    if (group) group.hits.push(hit);
    else groups.push({ section, hits: [hit] });
  }
  return groups;
}
