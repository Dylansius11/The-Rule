import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { atom_catalog, initSync } from '../../../../verifier/wasm/pkg/verifier_wasm.js';
import {
  bannedPhrases,
  headings,
  parseFrontmatter,
  parseName,
  parseWords,
  plainText,
  sections,
} from './helpers.mjs';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = resolve(web, '../..');
const content = resolve(process.env.DOCS_CONTENT_DIR || join(web, 'content/docs'));
const output = resolve(process.env.DOCS_OUTPUT_DIR || join(web, 'public'));
const env = readFileSync(join(web, 'src/config/env.ts'), 'utf8');
const trust = env.match(/export const TRUST_SENTENCE\s*=\s*'([^']+)'\s*;/)?.[1];
if (!trust) throw new Error('Unable to read TRUST_SENTENCE from src/config/env.ts');
const account = name => {
  const value = env.match(new RegExp(`read\\('${name}',\\s*'([^']+)'\\)`))?.[1];
  if (!value) throw new Error(`Missing ${name} default`);
  return value;
};
initSync({ module: readFileSync(join(root, 'verifier/wasm/pkg/verifier_wasm_bg.wasm')) });
const catalog = JSON.parse(atom_catalog());
const words = parseWords(readFileSync(join(root, 'crates/rule-core/src/words.rs'), 'utf8'));
if (
  catalog.atoms.length !== 90 ||
  catalog.atoms.some((a, i) => a.id !== i || !a.english || !a.negated || !a.dsl) ||
  new Set(catalog.atoms.map(a => a.english)).size !== 90 ||
  catalog.forms.length !== 3
)
  throw new Error('Invalid verifier wasm catalog');
const grammar = {
  grammar: 'g1',
  forms: catalog.forms,
  atoms: catalog.atoms,
  words,
  number: { min: 0, max: 999 },
  generatedFrom: 'verifier-wasm (atoms) + rule-core words.rs (words)',
};
const fairPath = join(web, 'content/generated/fair-laws.json');
if (existsSync(fairPath)) grammar.fairLaws = JSON.parse(readFileSync(fairPath, 'utf8'));
const docs = [];
const index = { sections: [] };
if (existsSync(content)) {
  for (const item of readdirSync(content, { withFileTypes: true })) {
    if (!item.isDirectory() || !sections.some(([id]) => id === item.name))
      throw new Error(`${join(content, item.name)}: unknown documentation section`);
  }
}
for (const [id, title] of sections) {
  const dir = join(content, id);
  const entries = [];
  const seen = new Set();
  if (existsSync(dir))
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      const { order, slug } = parseName(name, file);
      if (seen.has(slug)) throw new Error(`${file}: duplicate slug`);
      seen.add(slug);
      const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      const meta = parseFrontmatter(raw, file);
      const path = `/docs/${id}/${slug}.md`;
      const entry = {
        slug,
        section: id,
        title: meta.title,
        summary: meta.summary,
        order,
        path,
        headings: headings(meta.body),
        plain: plainText(meta.body),
      };
      entries.push(entry);
      docs.push({ ...entry, raw, body: meta.body, agent: meta.agent, file });
    }
  entries.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug, 'en'));
  index.sections.push({ id, title, entries });
}
docs.sort(
  (a, b) =>
    sections.findIndex(s => s[0] === a.section) - sections.findIndex(s => s[0] === b.section) ||
    a.order - b.order ||
    a.slug.localeCompare(b.slug, 'en'),
);
let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  /* Git is optional. */
}
const preamble = `# THE RULE — agent context\n\nTHE RULE is a NEAR testnet game in which players investigate a hidden law using paid plays. YES verdicts mint RULE and fees fund a NEAR pot. A correct commit-reveal guess can win the pot, and revealed verdicts can be replayed. Use this file as a starting point, then consult the linked documentation and current contract parameters.\n\n${trust}\n\nTestnet rehearsal accounts: game \`${account('VITE_GAME_ACCOUNT')}\`, token \`${account('VITE_TOKEN_ACCOUNT')}\`. Call the game's read-only \`get_params\` view for current parameters.\n\nSource: PolyForm Noncommercial 1.0.0 (source-available)\n${commit ? `\nBuild commit: ${commit}\n` : ''}`;
const demote = text => {
  let fenced = false;
  return text
    .split('\n')
    .map(line => {
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : line.replace(/^(#{1,5})(?=\s)/, '#$1');
    })
    .join('\n');
};
const escapeCell = s => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const appendix = `## Grammar appendix\n\n| ID | English | Negated | DSL |\n| --- | --- | --- | --- |\n${grammar.atoms.map(a => `| ${a.id} | ${escapeCell(a.english)} | ${escapeCell(a.negated)} | ${escapeCell(a.dsl)} |`).join('\n')}\n\n### Words\n\n${words.join(', ')}\n`;
const context = [
  preamble,
  ...docs.filter(d => d.agent).map(d => `## ${d.title}\n\n${demote(d.body.replaceAll(trust, '')).trim()}\n`),
  appendix,
].join('\n');
const llms = `# THE RULE\n\n> A testnet game for investigating a hidden law through plays and commit-reveal guesses.\n\n## Agent resources\n\n- [Context](/CONTEXT.md): Combined agent documentation and grammar.\n- [Grammar](/grammar.json): Machine-readable law catalog and words.\n${index.sections.map(section => (section.entries.length ? `\n## ${section.title}\n\n${section.entries.map(e => `- [${e.title}](${e.path}): ${e.summary}`).join('\n')}\n` : '')).join('')}`;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const files = new Map([
  ['CONTEXT.md', context],
  ['llms.txt', llms],
  ['grammar.json', json(grammar)],
  ['docs/index.json', json(index)],
  ...docs.map(d => [d.path.slice(1), d.raw]),
]);
const problems = [];
for (const doc of docs) for (const issue of bannedPhrases(doc.raw)) problems.push(`${doc.file}: ${issue}`);
for (const [path, data] of files) for (const issue of bannedPhrases(data)) problems.push(`${path}: ${issue}`);
if (problems.length) throw new Error(problems.join('\n'));
if (process.argv.includes('--lint')) {
  console.log('Documentation lint passed');
  process.exit(0);
}
rmSync(join(output, 'docs'), { recursive: true, force: true });
for (const [path, data] of files) {
  const file = join(output, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}
console.log(`Built ${docs.length} documentation pages`);
