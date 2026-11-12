/**
 * A small, safe Markdown parser for the subset the docs use: headings, paragraphs, nested lists, tables, fenced
 * code, blockquotes, links, emphasis, inline code and rules. It produces a plain data tree; nothing here builds
 * HTML, so the renderer can only ever create React elements (no `dangerouslySetInnerHTML`).
 *
 * Heading ids follow the docs pipeline (`scripts/docs/helpers.mjs`): GitHub-style slugs, unique per page. A
 * test keeps both in step on every real page.
 */

export type Align = 'left' | 'center' | 'right' | null;

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export type Block =
  | { t: 'heading'; depth: number; id: string | null; text: string; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: Block[][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' };

export interface PageHeading {
  depth: number;
  text: string;
  id: string;
}

export interface ParsedDoc {
  blocks: Block[];
  /** Every heading deeper than h1, in order, with its page-unique id. */
  headings: PageHeading[];
}

/** The same plain-text rule as the docs pipeline, so heading text and ids agree. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_~#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugBase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Hands out page-unique heading ids. */
export function createSlugger(): (text: string) => string {
  const used = new Set<string>();
  return text => {
    const base = slugBase(text);
    let id = base;
    let n = 1;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  };
}

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING_TOP = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HEADING_NESTED = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line: string) => line.trim() === '';

function itemMatch(line: string) {
  if (HR.test(line)) return null;
  return ITEM.exec(line);
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

function startsTable(lines: string[], i: number): boolean {
  const head = lines[i];
  const sep = lines[i + 1];
  if (head === undefined || sep === undefined || !head.includes('|') || !DELIMITER.test(sep)) return false;
  if (!sep.includes('|') && !sep.includes('-')) return false;
  return splitRow(head).length === splitRow(sep).length;
}

/** True when this line begins a block that may interrupt a paragraph. */
function interrupts(lines: string[], i: number): boolean {
  const line = lines[i]!;
  if (FENCE.test(line) || HEADING_NESTED.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const item = itemMatch(line);
  if (item && item[4] !== '' && (/^[-*+]$/.test(item[2]!) || /^1[.)]$/.test(item[2]!))) return true;
  return startsTable(lines, i);
}

function parseBlocks(lines: string[], slug: ((text: string) => string) | null, out: PageHeading[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const indent = fence[1]!.length;
      const mark = fence[2]!;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(next);
        if (close && close[1]![0] === mark[0] && close[1]!.length >= mark.length) {
          i++;
          break;
        }
        body.push(next.replace(new RegExp(`^ {0,${indent}}`), ''));
        i++;
      }
      blocks.push({ t: 'code', lang: fence[3]!, v: body.join('\n') });
      continue;
    }

    const heading = (slug ? HEADING_TOP : HEADING_NESTED).exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      const raw = heading[2]!;
      const text = plainText(raw);
      const id = slug ? slug(text) : null;
      if (id && depth > 1) out.push({ depth, text, id });
      blocks.push({ t: 'heading', depth, id, text, c: parseInline(raw) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^ {0,3}> ?/, ''));
        i++;
      }
      blocks.push({ t: 'quote', c: parseBlocks(body, null, out) });
      continue;
    }

    if (startsTable(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes('|')) {
        const cells = splitRow(lines[i]!);
        rows.push(head.map((_, c) => parseInline(cells[c] ?? '')));
        i++;
      }
      blocks.push({ t: 'table', align, head: head.map(parseInline), rows });
      continue;
    }

    const first = itemMatch(line);
    if (first) {
      const list = parseList(lines, i, out);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    const text: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]!) && !interrupts(lines, i)) {
      text.push(lines[i]!.replace(/^\s+/, ''));
      i++;
    }
    blocks.push({ t: 'p', c: parseInline(text.join('\n')) });
  }
  return blocks;
}

function parseList(lines: string[], from: number, out: PageHeading[]): { block: Block; next: number } {
  const first = itemMatch(lines[from]!)!;
  const ordered = /\d/.test(first[2]!);
  const start = ordered ? Number.parseInt(first[2]!, 10) : 1;
  const items: Block[][] = [];
  let tight = true;
  let i = from;

  while (i < lines.length) {
    const m = itemMatch(lines[i]!);
    if (!m || /\d/.test(m[2]!) !== ordered) break;
    const gap = m[3]!.length;
    const content = m[1]!.length + m[2]!.length + (gap === 0 || gap > 4 ? 1 : gap);
    const body: string[] = [m[3]!.length > 4 ? ' '.repeat(gap - 1) + m[4]! : m[4]!];
    i++;
    let sawBlank = false;
    while (i < lines.length) {
      const next = lines[i]!;
      if (isBlank(next)) {
        body.push('');
        sawBlank = true;
        i++;
        continue;
      }
      const indent = next.length - next.trimStart().length;
      if (indent >= content) {
        body.push(next.slice(content));
        sawBlank = false;
        i++;
        continue;
      }
      if (!sawBlank && !interrupts(lines, i) && !itemMatch(next)) {
        body.push(next.trim());
        i++;
        continue;
      }
      break;
    }
    // A blank line that only separates this item from the next is not part of the item.
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    if (body.some(isBlank) || (sawBlank && i < lines.length && itemMatch(lines[i]!))) tight = false;
    items.push(parseBlocks(body, null, out));
  }
  return { block: { t: 'list', ordered, start, tight, items }, next: i };
}

/** Parse one Markdown document (frontmatter, if present, is dropped). */
export function parseMarkdown(source: string): ParsedDoc {
  const text = source
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
    .replace(/^\t+/gm, m => '    '.repeat(m.length));
  const headings: PageHeading[] = [];
  const blocks = parseBlocks(text.split('\n'), createSlugger(), headings);
  return { blocks, headings };
}

// ---------------------------------------------------------------- inline

const PUNCT = /[!-/:-@[-`{-~]/;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

const isAlnum = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/** Index of the closing `]` that matches the `[` at `open`, skipping code spans and escapes. */
function matchBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') i++;
    else if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))![0];
      const close = src.indexOf(run, i + run.length);
      i = close === -1 ? i + run.length - 1 : close + run.length - 1;
    } else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** `(dest "title")` starting at `open`; returns the destination and the index after `)`. */
function parseDestination(src: string, open: number): { href: string; end: number } | null {
  let i = open + 1;
  while (src[i] === ' ') i++;
  let href = '';
  if (src[i] === '<') {
    const close = src.indexOf('>', i);
    if (close === -1) return null;
    href = src.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    while (i < src.length && !/\s/.test(src[i]!)) {
      const ch = src[i]!;
      if (ch === '\\' && i + 1 < src.length) {
        href += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '(') depth++;
      if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      href += ch;
      i++;
    }
  }
  while (src[i] === ' ') i++;
  if (src[i] === '"' || src[i] === "'") {
    const close = src.indexOf(src[i]!, i + 1);
    if (close === -1) return null;
    i = close + 1;
    while (src[i] === ' ') i++;
  }
  return src[i] === ')' ? { href, end: i + 1 } : null;
}

/** Find the delimiter that closes an emphasis run that opened at `from`, or -1. */
function findClose(src: string, from: number, delim: string): number {
  for (let i = from; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') i++;
    else if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))![0];
      const close = src.indexOf(run, i + run.length);
      i = close === -1 ? i + run.length - 1 : close + run.length - 1;
    } else if (src.startsWith(delim, i)) {
      if (delim.length === 1 && (src[i + 1] === ch || src[i - 1] === ch)) {
        // part of a longer run of the same mark: step over the run
        while (src[i + 1] === ch) i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

const BARE_URL = /^https?:\/\/[^\s<]+/;

/** Parse inline Markdown. Raw HTML is never interpreted: `<` is plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  const emit = (node: Inline) => {
    flush();
    out.push(node);
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;

    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        emit({ t: 'br' });
        i += 2;
        while (src[i] === ' ') i++;
      } else if (next !== undefined && PUNCT.test(next)) {
        buf += next;
        i += 2;
      } else {
        buf += ch;
        i++;
      }
      continue;
    }

    if (ch === '\n') {
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, '');
        emit({ t: 'br' });
      } else buf = buf.replace(/ +$/, '') + ' ';
      i++;
      while (src[i] === ' ') i++;
      continue;
    }

    if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))![0];
      const close = src.indexOf(run, i + run.length);
      if (close === -1) {
        buf += run;
        i += run.length;
        continue;
      }
      let code = src.slice(i + run.length, close).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
        code = code.slice(1, -1);
      }
      emit({ t: 'code', v: code });
      i = close + run.length;
      continue;
    }

    if (ch === '[') {
      const close = matchBracket(src, i);
      if (close !== -1 && src[close + 1] === '(') {
        const dest = parseDestination(src, close + 1);
        if (dest) {
          emit({ t: 'link', href: dest.href, c: parseInline(src.slice(i + 1, close)) });
          i = dest.end;
          continue;
        }
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === '<') {
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(src.slice(i));
      if (auto) {
        emit({ t: 'link', href: auto[1]!, c: [{ t: 'text', v: auto[1]! }] });
        i += auto[0].length;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === 'h' && !isAlnum(src[i - 1]) && BARE_URL.test(src.slice(i))) {
      let url = BARE_URL.exec(src.slice(i))![0];
      url = url.replace(/[.,;:!?'"]+$/, '');
      while (url.endsWith(')') && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
        url = url.slice(0, -1);
      }
      emit({ t: 'link', href: url, c: [{ t: 'text', v: url }] });
      i += url.length;
      continue;
    }

    if (ch === '&') {
      const entity = /^&(#\d{1,6}|#x[\da-f]{1,6}|[a-z]+);/i.exec(src.slice(i));
      if (entity) {
        const name = entity[1]!;
        let decoded: string | undefined;
        if (name[0] === '#') {
          const code =
            name[1]!.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
          decoded = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
        } else decoded = ENTITIES[name.toLowerCase()];
        if (decoded !== undefined) {
          buf += decoded;
          i += entity[0].length;
          continue;
        }
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      const double = src[i + 1] === ch;
      const delim = ch === '~' ? (double ? '~~' : '') : double ? ch + ch : ch;
      if (delim) {
        const after = src[i + delim.length];
        const before = src[i - 1];
        const canOpen = !isSpace(after) && (ch !== '_' || !isAlnum(before));
        if (canOpen) {
          const close = findClose(src, i + delim.length, delim);
          const valid =
            close > i + delim.length &&
            !isSpace(src[close - 1]) &&
            (ch !== '_' || !isAlnum(src[close + delim.length]));
          if (valid) {
            const kind = ch === '~' ? 'del' : delim.length === 2 ? 'strong' : 'em';
            emit({ t: kind, c: parseInline(src.slice(i + delim.length, close)) });
            i = close + delim.length;
            continue;
          }
        }
      }
      buf += delim || ch;
      i += (delim || ch).length;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- links

export type LinkKind = 'external' | 'route' | 'file' | 'hash';

export interface LinkTarget {
  kind: LinkKind;
  href: string;
}

/**
 * Decide how a link is rendered. Only http(s), mailto, root-relative, hash and relative targets pass; a
 * `javascript:` or `data:` target (even disguised with whitespace) is dropped and the link text stays plain.
 */
export function classifyLink(raw: string): LinkTarget | null {
  const href = raw.trim();
  const probe = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (probe === '') return null;
  if (/^(https?:|mailto:)/i.test(probe)) return { kind: 'external', href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe)) return null;
  if (probe.startsWith('//')) return null;
  if (probe.startsWith('#')) return { kind: 'hash', href };
  if (probe.startsWith('/')) {
    const path = href.split(/[?#]/)[0]!;
    const file = /\.[a-z0-9]{1,6}$/i.test(path.split('/').pop() ?? '') || path.startsWith('/art/');
    return { kind: file ? 'file' : 'route', href };
  }
  return { kind: 'file', href };
}

// ---------------------------------------------------------------- tables

/** The words of an inline run without markup. */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map(n => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : inlineText(n.c)))
    .join('');
}

/**
 * How wide each table column wants to be, in rem: about half a rem per character of its longest cell, plus the
 * cell padding, kept between 6 and 20 rem. Long prose cells wrap after about 40 characters instead of
 * collapsing into a sliver; the table scrolls inside its frame when the columns together outgrow the page.
 */
export function columnWidths(head: Inline[][], rows: Inline[][][]): number[] {
  return head.map((cell, c) => {
    const longest = Math.max(inlineText(cell).length, ...rows.map(row => inlineText(row[c] ?? []).length));
    return Math.min(20, Math.max(6, Math.ceil(longest * 0.5) + 2));
  });
}
