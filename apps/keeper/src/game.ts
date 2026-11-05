// Decisions mirror SMART-CONTRACT 'Round lifecycle'. `finalize` is proposed on every tick while
// a Reveal round is past its deadline: the contract sweeps unrevealed commits in batches and
// returns null until the round is Opening, so repeating the call is the protocol.
// `cancel` on a pending open is a harmless E50 panic; the contract only cancels failed opens.
// Times are u64 JSON numbers (or decimal strings); u128 amounts are strings.
export type Integer = number | string;
export type Mode = 0 | 1;
export interface Params {
  genesis_ns: Integer;
  round_period_ns: Integer;
  mode_offset_ns: [Integer, Integer];
  investigation_max_ns: Integer;
  reveal_window_ns: Integer;
  begin_timeout_ns: Integer;
  open_timeout_ns: Integer;
}
export type Phase = 'Scheduled' | 'Sealing' | 'Investigation' | 'Reveal' | 'Opening' | 'Settled' | 'Cancelled' | 'Void';
export type RequestStatus = 'none' | 'pending' | 'failed' | 'ok';
export interface Round {
  mode: Mode;
  round_id: number;
  phase: Phase;
  slot_ns: Integer;
  sealing_started_ns: Integer | null;
  begin_status: RequestStatus;
  investigation_end_ns: Integer | null;
  freeze_ns: Integer | null;
  reveal_deadline_ns: Integer | null;
  pending_checks: number;
  opening_started_ns: Integer | null;
  open_status: RequestStatus;
  pot: string;
  log_len: number;
}
export interface NextSlot { round_id: number; slot_ns: Integer }
export type Decision = { method: 'start_round' | 'advance' | 'finalize' | 'retry_open' | 'cancel'; args: { mode: Mode; round_id?: number } };

function ns(value: Integer | null): bigint {
  if (value === null || value === undefined || (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) || !/^\d+$/.test(String(value))) throw new Error('Invalid u64 timestamp');
  return BigInt(value);
}

export function decide(params: Params, rounds: Round[], slots: [NextSlot, NextSlot], now: bigint): Decision[] {
  const decisions: Decision[] = [];
  const blocked = [false, false];
  for (const round of rounds) {
    const { mode, round_id: id, phase } = round;
    if ((mode !== 0 && mode !== 1) || !Number.isSafeInteger(id) || id < 0) throw new Error('Invalid round identity');
    switch (phase) {
      case 'Scheduled':
        blocked[mode] = true;
        break;
      case 'Sealing':
        blocked[mode] = true;
        if (now >= ns(round.sealing_started_ns) + ns(params.begin_timeout_ns)) decisions.push({ method: 'cancel', args: { mode, round_id: id } });
        else if (round.begin_status === 'failed') decisions.push({ method: 'start_round', args: { mode } });
        else if (round.begin_status !== 'pending') throw new Error('Invalid begin status');
        break;
      case 'Investigation':
        blocked[mode] = true;
        if (now >= ns(round.investigation_end_ns)) decisions.push({ method: 'advance', args: { mode } });
        break;
      case 'Reveal':
        blocked[mode] = true;
        if (!Number.isSafeInteger(round.pending_checks) || round.pending_checks < 0) throw new Error('Invalid pending checks');
        if (now >= ns(round.reveal_deadline_ns) && round.pending_checks === 0) decisions.push({ method: 'finalize', args: { mode } });
        break;
      case 'Opening':
        if (now >= ns(round.opening_started_ns) + ns(params.open_timeout_ns)) decisions.push({ method: 'cancel', args: { mode, round_id: id } });
        else if (round.open_status === 'failed') decisions.push({ method: 'retry_open', args: { mode, round_id: id } });
        else if (round.open_status !== 'pending') throw new Error('Invalid open status');
        break;
      default: throw new Error('Unexpected active round phase');
    }
  }
  for (const mode of [0, 1] as const) {
    const slot = slots[mode];
    if (!Number.isSafeInteger(slot.round_id) || slot.round_id < 0) throw new Error('Invalid next round id');
    if (!blocked[mode] && now >= ns(slot.slot_ns)) decisions.push({ method: 'start_round', args: { mode } });
  }
  return decisions;
}
