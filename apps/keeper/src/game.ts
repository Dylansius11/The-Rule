// u64 values may be decimal strings when JSON literals exceed JavaScript's safe integer range.
export type Integer = number | string;
export type Mode = 0 | 1;
export interface Params {
  genesis_ns: Integer; round_period_ns: Integer; mode_offset_ns: [Integer, Integer];
  investigation_max_ns: Integer; reveal_window_ns: Integer; begin_timeout_ns: Integer; open_timeout_ns: Integer;
}
export type Phase = 'Scheduled' | 'Sealing' | 'Investigation' | 'Reveal' | 'Opening' | 'Settled' | 'Cancelled' | 'Void';
export type RequestStatus = 'none' | 'pending' | 'failed' | 'ok';
export interface Round {
  mode: Mode; round_id: number; phase: Phase; slot_ns: Integer; sealing_started_ns: Integer | null;
  begin_status: RequestStatus; investigation_end_ns: Integer | null; freeze_ns: Integer | null;
  reveal_deadline_ns: Integer | null; pending_checks: number; opening_started_ns: Integer | null;
  open_status: RequestStatus; pot: string; log_len: number;
}
export interface NextSlot { round_id: number; slot_ns: Integer }
export type Decision = { method: 'start_round' | 'advance' | 'finalize' | 'retry_open' | 'cancel'; args: { mode: Mode; round_id: number } };

export function uint(value: unknown, bits: 32 | 64 | 128): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) ||
      !/^(0|[1-9]\d*)$/.test(String(value))) throw new Error('Invalid integer');
  const n = BigInt(value);
  if (n >= (1n << BigInt(bits))) throw new Error('Integer out of range');
  return n;
}
function u32(value: unknown): void { uint(value, 32); if (typeof value !== 'number') throw new Error('Invalid u32'); }
function nullable(value: unknown): void { if (value !== null) uint(value, 64); }

export function decide(params: Params, rounds: Round[], slots: [NextSlot, NextSlot], now: bigint): Decision[] {
  if (now < 0n || now >= 1n << 64n || !params || !Array.isArray(params.mode_offset_ns) || params.mode_offset_ns.length !== 2 || !Array.isArray(rounds) || !Array.isArray(slots) || slots.length !== 2) throw new Error('Invalid snapshot');
  for (const value of [params.genesis_ns, params.round_period_ns, ...params.mode_offset_ns, params.investigation_max_ns, params.reveal_window_ns, params.begin_timeout_ns, params.open_timeout_ns]) uint(value, 64);
  const decisions: Decision[] = [];
  if (rounds.length > 10) throw new Error('Too many active rounds');
  const blocked = [false, false];
  const identities = new Set<string>();
  for (const round of rounds) {
    if (!round || (round.mode !== 0 && round.mode !== 1)) throw new Error('Invalid round identity');
    const { mode, round_id: id, phase } = round;
    u32(id); u32(round.pending_checks); u32(round.log_len);
    uint(round.slot_ns, 64); nullable(round.sealing_started_ns); nullable(round.investigation_end_ns);
    nullable(round.freeze_ns); nullable(round.reveal_deadline_ns); nullable(round.opening_started_ns);
    if (typeof round.pot !== 'string') throw new Error('Invalid amount');
    uint(round.pot, 128);
    if (!['none', 'pending', 'failed', 'ok'].includes(round.begin_status) || !['none', 'pending', 'failed', 'ok'].includes(round.open_status)) throw new Error('Invalid request status');
    const key = `${mode}:${id}`;
    if (identities.has(key)) throw new Error('Duplicate round');
    identities.add(key);
    if (phase !== 'Opening' && blocked[mode]) throw new Error('Multiple current rounds');
    switch (phase) {
      case 'Scheduled': blocked[mode] = true; break;
      case 'Sealing': {
        blocked[mode] = true;
        const deadline = [uint(round.sealing_started_ns, 64) + uint(params.begin_timeout_ns, 64), (1n << 64n) - 1n].reduce((a, b) => a < b ? a : b);
        if (round.begin_status === 'failed') decisions.push(now >= deadline ? { method: 'cancel', args: { mode, round_id: id } } : { method: 'start_round', args: { mode, round_id: id } });
        else if (round.begin_status !== 'pending') throw new Error('Invalid begin status');
        break;
      }
      case 'Investigation':
        blocked[mode] = true;
        if (now >= uint(round.investigation_end_ns, 64)) decisions.push({ method: 'advance', args: { mode, round_id: id } });
        break;
      case 'Reveal':
        blocked[mode] = true;
        if (now >= uint(round.reveal_deadline_ns, 64) && round.pending_checks === 0) decisions.push({ method: 'finalize', args: { mode, round_id: id } });
        break;
      case 'Opening': {
        const deadline = [uint(round.opening_started_ns, 64) + uint(params.open_timeout_ns, 64), (1n << 64n) - 1n].reduce((a, b) => a < b ? a : b);
        if (round.open_status === 'failed') decisions.push(now >= deadline ? { method: 'cancel', args: { mode, round_id: id } } : { method: 'retry_open', args: { mode, round_id: id } });
        else if (round.open_status !== 'pending') throw new Error('Invalid open status');
        break;
      }
      default: throw new Error('Unexpected active round phase');
    }
  }
  for (const mode of [0, 1] as const) {
    const slot = slots[mode];
    if (!slot) throw new Error('Invalid slot');
    u32(slot.round_id);
    if (!blocked[mode] && now >= uint(slot.slot_ns, 64)) decisions.push({ method: 'start_round', args: { mode, round_id: slot.round_id } });
    else uint(slot.slot_ns, 64);
  }
  return decisions;
}
