function formatUnits(value: bigint, decimals: number, digits = decimals): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > decimals) throw new Error('Invalid precision');
  const sign = value < 0n ? '-' : '';
  const raw = (value < 0n ? -value : value).toString().padStart(decimals + 1, '0');
  const fraction = raw.slice(-decimals).slice(0, digits).replace(/0+$/, '');
  return sign + raw.slice(0, -decimals) + (fraction ? `.${fraction}` : '');
}
export const formatNear = (value: bigint, digits = 24) => formatUnits(value, 24, digits);
export const formatRule = (value: bigint) => formatUnits(value, 18);
export function parseNear(text: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(text.trim());
  if (!match) throw new Error('Enter a non-negative NEAR amount with at most 24 decimal places');
  return BigInt(match[1]!) * 10n ** 24n + BigInt((match[2] ?? '').padEnd(24, '0'));
}
export const shortHash = (hash: string) =>
  hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-6)}`;
export function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
