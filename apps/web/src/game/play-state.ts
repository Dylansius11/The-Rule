import type { LogRow, PlayInput, PlayState, UiError } from './types';
export type PlayEvent =
  | { type: 'start'; input: PlayInput }
  | { type: 'known'; row: LogRow }
  | { type: 'sign' }
  | { type: 'pending'; txHash: string | null; sinceMs: number }
  | { type: 'row'; row: LogRow }
  | { type: 'refund' }
  | { type: 'error'; error: UiError }
  | { type: 'reset' };
export function playReducer(state: PlayState, event: PlayEvent): PlayState {
  switch (event.type) {
    case 'reset':
      return { kind: 'idle' };
    case 'start':
      return { kind: 'prechecking', input: event.input };
    case 'known':
      return state.kind === 'prechecking' || state.kind === 'pending'
        ? { kind: 'known', input: state.input, row: event.row }
        : state;
    case 'sign':
      return state.kind === 'prechecking' ? { kind: 'signing', input: state.input } : state;
    case 'pending':
      return state.kind === 'signing'
        ? { kind: 'pending', input: state.input, txHash: event.txHash, sinceMs: event.sinceMs }
        : state;
    case 'row':
      return state.kind === 'pending'
        ? {
            kind: event.row.verdict ? 'accepted' : 'rejected',
            input: state.input,
            row: event.row,
            txHash: state.txHash,
          }
        : state;
    case 'refund':
      return state.kind === 'pending'
        ? { kind: 'refunded', input: state.input, txHash: state.txHash }
        : state;
    case 'error':
      return { kind: 'error', input: 'input' in state ? state.input : null, error: event.error };
  }
}
