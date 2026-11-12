import { describe, expect, it } from 'vitest';
import { TERM_DOCS } from '@/ui/Term';
import {
  activeHeading,
  docRoute,
  docTitle,
  findEntry,
  findSection,
  flatten,
  kilobytes,
  neighbours,
  SECTION_BLURB,
  tocOf,
} from './model';
import { loadContent } from './testContent';

const { index, pages } = loadContent();

describe('paths and lookup', () => {
  it('maps an entry to its route, never to the raw file', () => {
    expect(docRoute({ section: 'play', slug: 'how-to-play' })).toBe('/docs/play/how-to-play');
  });

  it('finds entries and sections, and nothing for an unknown address', () => {
    expect(findEntry(index, 'trust', 'trust-model')?.title).toBeTruthy();
    expect(findEntry(index, 'trust', 'nope')).toBeUndefined();
    expect(findEntry(index, 'nope', 'trust-model')).toBeUndefined();
    expect(findEntry(index, undefined, undefined)).toBeUndefined();
    expect(findSection(index, 'rule')?.title).toBe('RULE token');
  });

  it('has a blurb for every real section', () => {
    for (const section of index.sections) expect(SECTION_BLURB[section.id], section.id).toBeTruthy();
  });
});

describe('previous and next', () => {
  const all = flatten(index);

  it('flattens in reading order', () => {
    expect(all).toHaveLength(25);
    expect(all[0]!.section).toBe('play');
  });

  it('crosses a section edge', () => {
    const lastPlay = index.sections[0]!.entries.at(-1)!;
    expect(neighbours(index, lastPlay).next).toBe(index.sections[1]!.entries[0]);
    expect(neighbours(index, index.sections[1]!.entries[0]!).prev).toBe(lastPlay);
  });

  it('has no previous on the first page and no next on the last', () => {
    expect(neighbours(index, all[0]!).prev).toBeUndefined();
    expect(neighbours(index, all.at(-1)!).next).toBeUndefined();
  });

  it('chains every page to the next one exactly once', () => {
    for (let i = 0; i < all.length - 1; i++) expect(neighbours(index, all[i]!).next).toBe(all[i + 1]);
  });

  it('reports no neighbours for an entry that is not in the index', () => {
    const stray = { ...all[0]!, slug: 'stray' };
    expect(neighbours(index, stray)).toEqual({ prev: undefined, next: undefined });
  });
});

describe('table of contents', () => {
  it('keeps h2 and h3 only, in order', () => {
    const items = tocOf([
      { depth: 2, text: 'A', id: 'a' },
      { depth: 3, text: 'B', id: 'b' },
      { depth: 4, text: 'C', id: 'c' },
      { depth: 2, text: 'D', id: 'd' },
    ]);
    expect(items.map(h => h.id)).toEqual(['a', 'b', 'd']);
  });

  it('every FAQ question is reachable from the contents list', () => {
    const faq = findEntry(index, 'play', 'faq')!;
    expect(tocOf(faq.headings).length).toBe(faq.headings.length);
  });
});

describe('scroll spy', () => {
  const tops = [
    { id: 'a', top: -400 },
    { id: 'b', top: 40 },
    { id: 'c', top: 700 },
  ];
  it('picks the last heading that reached the offset', () => {
    expect(activeHeading(tops, 100)).toBe('b');
    expect(activeHeading(tops, 800)).toBe('c');
  });
  it('is the first heading before any has reached it, and undefined without headings', () => {
    expect(activeHeading([{ id: 'a', top: 300 }], 100)).toBe('a');
    expect(activeHeading([], 100)).toBeUndefined();
  });
});

describe('titles and sizes', () => {
  it('builds a title most specific first and ends with the product', () => {
    expect(docTitle('How to play', 'Play', 'Docs')).toBe('How to play · Play · Docs · THE RULE');
    expect(docTitle(undefined, 'Docs')).toBe('Docs · THE RULE');
  });

  it('counts the bytes of the UTF-8 text, not its characters', () => {
    expect(kilobytes('a'.repeat(1024))).toBe('1.0 kB');
    expect(kilobytes('é'.repeat(512))).toBe('1.0 kB');
  });
});

describe('Term links into the docs', () => {
  it.each(Object.entries(TERM_DOCS))('%s points at a real page and heading', (_term, target) => {
    const [path, hash] = target.split('#');
    const [, , section, slug] = path!.split('/');
    const page = pages.find(p => p.entry.section === section && p.entry.slug === slug);
    expect(page, path).toBeDefined();
    if (hash)
      expect(
        page!.entry.headings.map(h => h.id),
        target,
      ).toContain(hash);
  });
});
