// Test helper: the real docs content read straight from `content/docs`, shaped like the generated index.json.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  headings,
  parseFrontmatter,
  parseName,
  plainText,
  sections,
} from '../../../scripts/docs/helpers.mjs';
import type { DocEntry, DocsIndex } from '@/docs/types';

const content = resolve(fileURLToPath(new URL('../../..', import.meta.url)), 'content/docs');

export interface ContentPage {
  entry: DocEntry;
  body: string;
  source: string;
}

/** Every page of the real content, with the raw source and the body without frontmatter. */
export function loadContent(): { index: DocsIndex; pages: ContentPage[] } {
  const pages: ContentPage[] = [];
  const index: DocsIndex = { sections: [] };
  for (const [id, title] of sections as [string, string][]) {
    const entries: DocEntry[] = [];
    for (const name of readdirSync(join(content, id)).sort()) {
      const source = readFileSync(join(content, id, name), 'utf8').replace(/\r\n/g, '\n');
      const meta = parseFrontmatter(source, name);
      const { order, slug } = parseName(name);
      const entry: DocEntry = {
        slug,
        section: id,
        title: meta.title,
        summary: meta.summary,
        order,
        path: `/docs/${id}/${slug}.md`,
        headings: headings(meta.body),
        plain: plainText(meta.body),
      };
      entries.push(entry);
      pages.push({ entry, body: meta.body, source });
    }
    index.sections.push({ id, title, entries });
  }
  return { index, pages };
}
