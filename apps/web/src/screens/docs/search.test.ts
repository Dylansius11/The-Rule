import { describe, expect, it } from 'vitest';
import { highlight, queryTerms, searchDocs, snippetOf } from './search';
import { loadContent } from './testContent';

const { index } = loadContent();
const firstHit = (query: string) => searchDocs(index, query)[0]?.hits[0];
const joined = (parts: { text: string }[]) => parts.map(p => p.text).join('');

describe('query terms', () => {
  it('lower-cases, splits on punctuation, drops repeats and caps at six', () => {
    expect(queryTerms(' Storage,  charge STORAGE ')).toEqual(['storage', 'charge']);
    expect(queryTerms('a b c d e f g h')).toHaveLength(6);
    expect(queryTerms('   ')).toEqual([]);
  });
});

describe('highlight', () => {
  it('marks every match and keeps the text intact', () => {
    const parts = highlight('The stake is a stake.', ['stake']);
    expect(joined(parts)).toBe('The stake is a stake.');
    expect(parts.filter(p => p.hit).map(p => p.text)).toEqual(['stake', 'stake']);
  });

  it('matches a plural query against the singular text and escapes regex characters', () => {
    expect(highlight('one attempt left', ['attempts']).some(p => p.hit)).toBe(true);
    expect(() => highlight('a (b) c', ['(b)'])).not.toThrow();
    expect(highlight('plain', [])).toEqual([{ text: 'plain', hit: false }]);
  });
});

describe('snippets', () => {
  const plain = `${'lead '.repeat(60)}the storage charge is not refunded ${'tail '.repeat(60)}`;
  it('centres on the first match with ellipses on both cut sides', () => {
    const parts = snippetOf(plain, ['storage']);
    const out = joined(parts);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('storage charge');
    expect(out.length).toBeLessThan(200);
    expect(parts.find(p => p.hit)?.text).toBe('storage');
  });

  it('drops the table delimiter row the index keeps as text', () => {
    expect(joined(snippetOf('Thresholds Extra attempts --- --- --- 1,000 25', ['attempts']))).toBe(
      'Thresholds Extra attempts 1,000 25',
    );
    expect(joined(snippetOf('a well-known --- b', ['well']))).toBe('a well-known b');
  });

  it('shows the start of the text when nothing matches', () => {
    const out = joined(snippetOf('short text here', ['zzz']));
    expect(out).toBe('short text here');
  });
});

describe('search over the real docs', () => {
  it('finds the storage charge: the FAQ question first, the costs page among the results', () => {
    const hit = firstHit('storage charge');
    expect(hit?.entry.slug).toBe('faq');
    expect(hit?.heading?.text).toBe('What is the storage charge?');
    expect(hit?.snippet.some(p => p.hit)).toBe(true);
    const slugs = searchDocs(index, 'storage charge').flatMap(g => g.hits.map(h => h.entry.slug));
    expect(slugs).toContain('costs-and-payouts');
  });

  it('finds "attempts" and links to a heading when one matches', () => {
    const groups = searchDocs(index, 'attempts');
    expect(groups.length).toBeGreaterThan(0);
    const slugs = groups.flatMap(g => g.hits.map(h => h.entry.slug));
    expect(slugs).toContain('locking-for-attempts');
  });

  it('requires every word: a stray word removes the page', () => {
    expect(searchDocs(index, 'storage charge zzzznotaword')).toEqual([]);
  });

  it('is empty for an empty query', () => {
    expect(searchDocs(index, '   ')).toEqual([]);
  });

  it('ranks a title match above a body mention', () => {
    const hit = firstHit('costs and payouts');
    expect(hit?.entry.slug).toBe('costs-and-payouts');
  });

  it('groups by section, each page once, best section first', () => {
    const groups = searchDocs(index, 'replay');
    const paths = groups.flatMap(g => g.hits.map(h => h.entry.path));
    expect(new Set(paths).size).toBe(paths.length);
    for (const g of groups) expect(g.hits.every(h => h.entry.section === g.section.id)).toBe(true);
    const best = groups.map(g => Math.max(...g.hits.map(h => h.score)));
    expect(best).toEqual([...best].sort((a, b) => b - a));
  });

  it('honours the result limit', () => {
    const hits = searchDocs(index, 'the', 5).flatMap(g => g.hits);
    expect(hits).toHaveLength(5);
  });
});
