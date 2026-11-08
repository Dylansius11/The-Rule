import type { LogRow } from '@/game/types';
import { pad3 } from './round';

const toRecord = (r: LogRow) => ({
  log_idx: r.logIdx,
  seq: r.seq,
  account: r.account,
  number: pad3(r.number),
  word: r.word,
  word_id: r.wordId,
  minute_digit: r.minuteDigit,
  verdict: r.verdict ? 'YES' : 'NO',
  minted_base_units: r.minted.toString(),
});
const CSV_HEAD = [
  'log_idx',
  'seq',
  'account',
  'number',
  'word',
  'word_id',
  'minute_digit',
  'verdict',
  'minted_base_units',
] as const;

function toCsv(rows: LogRow[]) {
  const esc = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  return [CSV_HEAD.join(','), ...rows.map(r => CSV_HEAD.map(h => esc(toRecord(r)[h])).join(','))].join('\n');
}

/** Download exactly these rows as CSV or JSON. Numbers keep three digits; minted stays in base units as a string. */
export function downloadLog(rows: LogRow[], baseName: string, format: 'csv' | 'json') {
  const text = format === 'csv' ? toCsv(rows) : JSON.stringify(rows.map(toRecord), null, 2);
  const url = URL.createObjectURL(
    new Blob([text], { type: format === 'csv' ? 'text/csv' : 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
