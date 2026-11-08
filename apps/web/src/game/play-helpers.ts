import { LocalPlayError } from '@/chain/errors';
import type { WirePlay } from '@/chain/views';
import type { EntityLine, LogRow, PlayInput } from './types';

export type PlayAck = { status: 'Pending'; seq: number } | { status: 'Known'; logIdx: number };

export function buildPlayContext(
  input: PlayInput,
  words: string[],
  line: EntityLine | null,
  timestampMs: number,
): WirePlay {
  const wordId = words.indexOf(input.word.trim().toLowerCase());
  if (wordId < 0 || !Number.isInteger(input.number) || input.number < 0 || input.number > 999) {
    throw new LocalPlayError('input');
  }
  const elapsed = line ? Math.max(0, timestampMs - line.atMs) : 0;
  return {
    number: input.number,
    word_id: wordId,
    minute_digit: Math.floor(timestampMs / 60_000) % 10,
    prev: line
      ? {
          number: line.number,
          word_id: line.wordId,
          gap_bucket: elapsed < 60_000 ? 0 : elapsed < 3_600_000 ? 1 : 2,
        }
      : null,
  };
}

export function parsePlayAck(value: unknown): PlayAck | null {
  if (!value || typeof value !== 'object') return null;
  const ack = value as Record<string, unknown>;
  if (ack.status === 'Pending' && Number.isSafeInteger(ack.seq) && (ack.seq as number) >= 0) {
    return { status: 'Pending', seq: ack.seq as number };
  }
  if (ack.status === 'Known' && Number.isSafeInteger(ack.log_idx) && (ack.log_idx as number) >= 0) {
    return { status: 'Known', logIdx: ack.log_idx as number };
  }
  return null;
}

export function findPlayRow(rows: LogRow[], ack: PlayAck): LogRow | undefined {
  return rows.find(row => (ack.status === 'Pending' ? row.seq === ack.seq : row.logIdx === ack.logIdx));
}

export function detectRefund(
  ack: PlayAck,
  entityPending: boolean,
  playerPending: boolean | undefined,
  before: bigint | undefined,
  after: bigint | undefined,
): boolean {
  return (
    ack.status === 'Pending' &&
    !entityPending &&
    playerPending === false &&
    before != null &&
    after != null &&
    after >= before
  );
}
