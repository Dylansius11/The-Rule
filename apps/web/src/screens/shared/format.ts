const utc = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

export const fmtUtc = (ms: number) => `${utc.format(new Date(ms))} UTC`;

export function fmtIn(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  const abs = Math.abs(s);
  const text =
    abs < 90
      ? `${abs}s`
      : abs < 5400
        ? `${Math.round(abs / 60)} min`
        : abs < 172800
          ? `${Math.round(abs / 3600)} h`
          : `${Math.round(abs / 86400)} d`;
  return s >= 0 ? `in ${text}` : `${text} ago`;
}

export const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
