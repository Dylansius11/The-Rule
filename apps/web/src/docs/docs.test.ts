import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bannedPhrases,
  headings,
  parseFrontmatter,
  parseName,
  parseWords,
} from '../../scripts/docs/helpers.mjs';
import { TRUST_SENTENCE } from '../config/env';
import type { DocsIndex, Grammar } from './types';

const web = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const root = resolve(web, '../..');
const fixture = join(web, 'src/docs/__fixtures__');
const script = join(web, 'scripts/docs/build.mjs');

function files(dir: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(item => item.isFile())
      .map(item => {
        const full = join(item.parentPath, item.name);
        return [full.slice(dir.length + 1).replaceAll('\\', '/'), readFileSync(full, 'utf8')];
      }),
  );
}

function build(content: string, output: string) {
  execFileSync(process.execPath, [script], {
    cwd: web,
    env: { ...process.env, DOCS_CONTENT_DIR: content, DOCS_OUTPUT_DIR: output },
  });
}

describe('docs pipeline', () => {
  it('parses frontmatter and identifies malformed input by file', () => {
    expect(
      parseFrontmatter('---\ntitle: "A title"\nsummary: Short\nagent: false\n---\nBody', 'one.md'),
    ).toEqual({ title: 'A title', summary: 'Short', agent: false, body: 'Body' });
    for (const input of [
      'title: Missing',
      '---\ntitle: Only\n---\n',
      '---\ntitle: A\nsummary: B\nagent: maybe\n---\n',
      '---\ntitle: A\ntitle: B\nsummary: C\n---\n',
    ]) {
      expect(() => parseFrontmatter(input, 'broken.md')).toThrow('broken.md');
    }
  });
  it('validates ordered slugs and produces unique heading ids', () => {
    expect(parseName('03-first-play.md')).toEqual({ order: 3, slug: 'first-play' });
    expect(() => parseName('3-First.md', 'bad.md')).toThrow('bad.md');
    expect(
      headings(
        '## Hello, world!\n## Hello world\n## Hello world-1\n## Hello world\n```\n## ignored\n```',
      ).map(h => h.id),
    ).toEqual(['hello-world', 'hello-world-1', 'hello-world-1-1', 'hello-world-2']);
    expect(headings('# Same\n## Same').map(h => h.id)).toEqual(['same-1']);
  });
  it('loads 128 unique words from rule-core', () => {
    const words = parseWords(readFileSync(join(root, 'crates/rule-core/src/words.rs'), 'utf8'));
    expect(words).toHaveLength(128);
    expect(new Set(words).size).toBe(128);
    expect(() => parseWords('invalid')).toThrow();
  });
  it('detects banned phrases and value promises while allowing the explicit exception', () => {
    for (const phrase of [
      'provably fair',
      'unhackable',
      'nobody can ever know',
      'guaranteed',
      'to the moon',
      'open-source',
      'open source',
      'RULE will increase in price.',
    ])
      expect(bannedPhrases(phrase)).not.toEqual([]);
    expect(bannedPhrases('This is not open source. RULE has no redemption.')).toEqual([]);
  });
  it('builds empty and fixture content deterministically using the real wasm', () => {
    const temp = mkdtempSync(join(tmpdir(), 'the-rule-docs-'));
    try {
      const out = join(temp, 'out');
      build(join(temp, 'missing'), out);
      expect(
        (JSON.parse(readFileSync(join(out, 'docs/index.json'), 'utf8')) as DocsIndex).sections.every(
          s => !s.entries.length,
        ),
      ).toBe(true);
      build(fixture, out);
      const first = files(out);
      build(fixture, out);
      expect(files(out)).toEqual(first);
      const grammar = JSON.parse(first['grammar.json']!) as Grammar;
      expect(grammar.atoms.map(a => a.id)).toEqual(Array.from({ length: 90 }, (_, i) => i));
      expect(new Set(grammar.atoms.map(a => a.english)).size).toBe(90);
      expect(grammar.atoms.every(a => a.english.length > 0)).toBe(true);
      expect(new Set(grammar.words).size).toBe(128);
      expect(first['CONTEXT.md']!.split(TRUST_SENTENCE)).toHaveLength(2);
      expect(first['CONTEXT.md']).not.toContain('This page is excluded');
      const index = JSON.parse(first['docs/index.json']!) as DocsIndex;
      expect(index.sections[0]!.entries.map(e => e.slug)).toEqual(['private', 'experiments']);
      expect(index.sections[0]!.entries[1]!.headings.map(h => h.id)).toEqual([
        'the-first-step',
        'the-first-step-1',
      ]);
      for (const content of Object.values(first)) expect(bannedPhrases(content)).toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
