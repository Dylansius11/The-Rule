import { describe, expect, it } from 'vitest';
import {
  classifyLink,
  columnWidths,
  inlineText,
  parseInline,
  parseMarkdown,
  type Block,
  type Inline,
} from './parse';
import { loadContent } from './testContent';

const first = (source: string): Block => parseMarkdown(source).blocks[0]!;
const text = (nodes: Inline[]): string =>
  nodes.map(n => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? '\n' : text(n.c))).join('');

describe('blocks', () => {
  it('drops frontmatter and reads headings with page-unique ids', () => {
    const doc = parseMarkdown('---\ntitle: T\nsummary: S\n---\n\n## One\n\n## One\n\n### Two & three\n');
    expect(doc.headings).toEqual([
      { depth: 2, text: 'One', id: 'one' },
      { depth: 2, text: 'One', id: 'one-1' },
      { depth: 3, text: 'Two & three', id: 'two--three' },
    ]);
    expect(doc.blocks.map(b => b.t)).toEqual(['heading', 'heading', 'heading']);
  });

  it('keeps a heading-looking line inside a fenced block as code', () => {
    const doc = parseMarkdown('```sh\n# not a heading\ncurl x\n```\n\n## Real\n');
    expect(doc.blocks[0]).toEqual({ t: 'code', lang: 'sh', v: '# not a heading\ncurl x' });
    expect(doc.headings.map(h => h.id)).toEqual(['real']);
  });

  it('merges a paragraph over several lines and honours a hard break', () => {
    const block = first('one\ntwo  \nthree');
    expect(block.t).toBe('p');
    if (block.t === 'p') expect(text(block.c)).toBe('one two\nthree');
  });

  it('reads tables with alignment and escaped pipes', () => {
    const block = first('| A | B |\n| :-- | --: |\n| x \\| y | `z` |\n');
    expect(block.t).toBe('table');
    if (block.t !== 'table') return;
    expect(block.align).toEqual(['left', 'right']);
    expect(text(block.rows[0]![0]!)).toBe('x | y');
    expect(block.rows[0]![1]![0]).toEqual({ t: 'code', v: 'z' });
  });

  it('pads a short row so every row has the header width', () => {
    const block = first('| A | B | C |\n| - | - | - |\n| 1 |\n');
    if (block.t === 'table') expect(block.rows[0]).toHaveLength(3);
  });

  it('reads ordered, tight and nested lists', () => {
    const block = first('3. one\n4. two\n   - inner a\n   - inner b\n5. three');
    expect(block.t).toBe('list');
    if (block.t !== 'list') return;
    expect(block.ordered).toBe(true);
    expect(block.start).toBe(3);
    expect(block.tight).toBe(true);
    expect(block.items).toHaveLength(3);
    const inner = block.items[1]![1]!;
    expect(inner.t).toBe('list');
    if (inner.t === 'list') expect(inner.items).toHaveLength(2);
  });

  it('marks a list with blank lines between items as loose', () => {
    const block = first('- a\n\n- b\n');
    if (block.t === 'list') expect(block.tight).toBe(false);
  });

  it('reads blockquotes, rules and ends a list at the next paragraph', () => {
    const doc = parseMarkdown('> quoted\n> more\n\n---\n\n- item\n\nafter');
    expect(doc.blocks.map(b => b.t)).toEqual(['quote', 'hr', 'list', 'p']);
  });
});

describe('inline', () => {
  it('reads code, emphasis and links', () => {
    const nodes = parseInline('a **bold** and *it* with `co*de` and [link](/x)');
    expect(nodes.map(n => n.t)).toEqual(['text', 'strong', 'text', 'em', 'text', 'code', 'text', 'link']);
    expect(nodes[5]).toEqual({ t: 'code', v: 'co*de' });
  });

  it('does not treat snake_case or a lone star as emphasis', () => {
    expect(text(parseInline('use get_round and commit_seq here'))).toBe('use get_round and commit_seq here');
    expect(parseInline('2 * 3 * 4').every(n => n.t === 'text')).toBe(true);
  });

  it('never interprets raw HTML', () => {
    const nodes = parseInline('<script>alert(1)</script> and <b>x</b>');
    expect(nodes.every(n => n.t === 'text')).toBe(true);
    expect(text(nodes)).toBe('<script>alert(1)</script> and <b>x</b>');
  });

  it('decodes the few entities it knows and leaves the rest', () => {
    expect(text(parseInline('a &amp; b &lt;c&gt; &bogus;'))).toBe('a & b <c> &bogus;');
  });

  it('autolinks bare addresses without the trailing full stop', () => {
    const nodes = parseInline('see https://example.com/a.');
    expect(nodes[1]).toEqual({
      t: 'link',
      href: 'https://example.com/a',
      c: [{ t: 'text', v: 'https://example.com/a' }],
    });
    expect(text(nodes)).toBe('see https://example.com/a.');
  });

  it('keeps balanced parentheses inside a link destination', () => {
    const [link] = parseInline('[x](/a_(b))');
    expect(link).toMatchObject({ t: 'link', href: '/a_(b)' });
  });
});

describe('table columns', () => {
  it('reads plain words out of markup', () => {
    expect(inlineText(parseInline('a **b** \`c\` [d](/x)'))).toBe('a b c d');
  });

  it('sizes a column to its longest cell, between 6 and 20 rem', () => {
    const block = first('| A | Description |\n| - | - |\n| \`x\` | ' + 'word '.repeat(40) + ' |\n');
    if (block.t !== 'table') throw new Error('not a table');
    const [narrow, wide] = columnWidths(block.head, block.rows);
    expect(narrow).toBe(6);
    expect(wide).toBe(20);
  });

  it('grows with the text in between', () => {
    const block = first('| Name |\n| - |\n| ' + 'x'.repeat(20) + ' |\n');
    if (block.t === 'table') expect(columnWidths(block.head, block.rows)).toEqual([12]);
  });
});

describe('links', () => {
  it.each([
    ['https://example.com', 'external'],
    ['mailto:a@b.co', 'external'],
    ['/docs/play/how-to-play', 'route'],
    ['/docs/play/how-to-play#guess-in-four-steps', 'route'],
    ['/season', 'route'],
    ['/CONTEXT.md', 'file'],
    ['/grammar.json', 'file'],
    ['/art/blot/idle.webp', 'file'],
    ['#section', 'hash'],
  ] as const)('%s is %s', (href, kind) => {
    expect(classifyLink(href)).toEqual({ kind, href });
  });

  it.each([
    'javascript:alert(1)',
    ' JaVaScript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,x',
    '//evil.test/x',
    '',
  ])('drops %j', href => {
    expect(classifyLink(href)).toBeNull();
  });
});

describe('the real docs content', () => {
  const { pages } = loadContent();

  it('finds all 23 pages', () => {
    expect(pages).toHaveLength(23);
  });

  it.each(pages.map(p => [`${p.entry.section}/${p.entry.slug}`, p] as const))(
    '%s: heading ids equal the pipeline index',
    (_name, page) => {
      expect(parseMarkdown(page.source).headings).toEqual(page.entry.headings);
    },
  );

  it.each(pages.map(p => [`${p.entry.section}/${p.entry.slug}`, p] as const))(
    '%s: every link has a safe target and nothing is left as raw HTML',
    (_name, page) => {
      const walk = (nodes: Inline[]): Inline[] => nodes.flatMap(n => [n, ...('c' in n ? walk(n.c) : [])]);
      const inlines: Inline[] = [];
      const visit = (blocks: Block[]) => {
        for (const b of blocks) {
          if (b.t === 'p' || b.t === 'heading') inlines.push(...walk(b.c));
          else if (b.t === 'quote') visit(b.c);
          else if (b.t === 'list') b.items.forEach(visit);
          else if (b.t === 'table') [...b.head, ...b.rows.flat()].forEach(c => inlines.push(...walk(c)));
        }
      };
      visit(parseMarkdown(page.source).blocks);
      for (const n of inlines) if (n.t === 'link') expect(classifyLink(n.href), n.href).not.toBeNull();
    },
  );
});
