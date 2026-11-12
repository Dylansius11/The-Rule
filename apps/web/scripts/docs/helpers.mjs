export const sections = [
  ['play', 'Play'],
  ['agents', 'Agents'],
  ['trust', 'Trust'],
  ['rule', 'RULE token'],
  ['brand', 'Brand'],
];

export function parseFrontmatter(source, file) {
  const match = source.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing or malformed frontmatter`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const item = line.match(/^([a-z]+):\s*(.*?)\s*$/);
    if (!item || !['title', 'summary', 'agent'].includes(item[1]) || item[1] in fields)
      throw new Error(`${file}: invalid frontmatter line: ${line}`);
    let value = item[2];
    if (/^["']/.test(value)) {
      if (value.length < 2 || value.at(-1) !== value[0])
        throw new Error(`${file}: unterminated quoted value`);
      if (value[0] === '"') {
        try {
          value = JSON.parse(value);
        } catch {
          throw new Error(`${file}: invalid quoted value`);
        }
      } else value = value.slice(1, -1).replace(/''/g, "'");
    }
    fields[item[1]] = value;
  }
  if (
    !fields.title ||
    !fields.summary ||
    (fields.agent !== undefined && !['true', 'false'].includes(fields.agent))
  )
    throw new Error(`${file}: title and summary are required; agent must be true or false`);
  return { title: fields.title, summary: fields.summary, agent: fields.agent !== 'false', body: match[2] };
}

export function parseName(name, file = name) {
  const match = name.match(/^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
  if (!match) throw new Error(`${file}: expected NN-slug.md`);
  return { order: Number(match[1]), slug: match[2] };
}

export function plainText(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/gm, ' ')
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_~#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function headings(body) {
  const used = new Set();
  let fenced = false;
  const result = [];
  for (const line of body.split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = plainText(match[2]);
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
      .replace(/ /g, '-');
    let id = base,
      n = 1;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    if (match[1].length > 1) result.push({ depth: match[1].length, text, id });
  }
  return result;
}

export function parseWords(source) {
  const match = source.match(/pub const WORDS:\s*\[&str;\s*128\]\s*=\s*\[([\s\S]*?)\];/);
  if (!match || !/^(?:\s*"[a-z]+"\s*,)*\s*$/.test(match[1]))
    throw new Error('Invalid rule-core WORDS declaration');
  const words = [...match[1].matchAll(/"([a-z]+)"/g)].map(m => m[1]);
  if (words.length !== 128 || new Set(words).size !== 128)
    throw new Error('Expected 128 unique rule-core words');
  return words;
}

export function bannedPhrases(text) {
  const cleaned = text.replace(/not open[ -]source/gi, '');
  const errors = [];
  for (const pattern of [
    /provably fair/i,
    /unhackable/i,
    /nobody can ever know/i,
    /guaranteed/i,
    /to the moon/i,
    /open[ -]source/i,
  ]) {
    if (pattern.test(cleaned)) errors.push(`banned phrase: ${pattern.source}`);
  }
  for (const sentence of cleaned.split(/(?<=[.!?])\s+|\n+/)) {
    if (
      /\bRULE\b/.test(sentence) &&
      /\b(price|returns?|redemption|redeem|liquidity)\b/i.test(sentence) &&
      /\b(will|shall|guarantee[sd]?|promis(?:e|es|ed)|ensure[sd]?|provides?|offers?|earn|profit|increase|rise|grow|redeemable)\b/i.test(
        sentence,
      ) &&
      !/\b(no|not|never|without|neither|nor|doesn't|does not|isn't|is not|cannot|can't)\b/i.test(sentence)
    )
      errors.push('possible RULE value promise');
  }
  return errors;
}
