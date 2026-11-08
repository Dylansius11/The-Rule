import { active } from '@/config/env';
import type {
  Commit,
  Entity,
  LogRow,
  Mode,
  Params,
  Player,
  Round,
  Team,
  TokenOperation,
  TokenOutcome,
} from '@/game/types';
import { view, MethodNotFound, RpcError } from './rpc';
import { readSeasonPages, type SeasonBoard, type SeasonRow, type SeasonStatus } from '@/game/season';

type Wire = Record<string, any>;
const ms = (v: number | string | null | undefined): number | null =>
  v == null ? null : Math.floor(Number(v) / 1_000_000);
export function decodeRound(r: Wire): Round {
  const o = r.outcome;
  return {
    mode: r.mode,
    roundId: r.round_id,
    phase: r.phase,
    demo: r.demo,
    commit: r.commit,
    header: r.header,
    seed: r.seed,
    pot: BigInt(r.pot),
    allowanceLeft: BigInt(r.allowance_left),
    logLen: r.log_len,
    pendingChecks: r.pending_checks,
    sealedAtMs: ms(r.sealing_started_ns),
    investigationEndMs: ms(r.investigation_end_ns),
    freezeMs: ms(r.freeze_ns),
    revealDeadlineMs: ms(r.reveal_deadline_ns),
    outcome:
      o?.kind === 'Solved'
        ? { kind: 'Solved', account: o.account, entityTag: o.entity_tag, entityId: o.entity_id }
        : o,
    rule: r.rule,
    salt: r.salt,
  };
}
export function decodeLogRow(r: Wire, words: string[]): LogRow {
  const p = r.play;
  if (typeof words[p.word_id] !== 'string') throw new Error('Log references an unknown word');
  return {
    logIdx: r.log_idx,
    seq: r.seq,
    playKey: String(r.play_key),
    entityTag: r.entity_tag,
    entityId: r.entity_id,
    account: r.account,
    actor: r.actor,
    number: p.number,
    wordId: p.word_id,
    word: words[p.word_id]!,
    minuteDigit: p.minute_digit,
    prev: p.prev ? { number: p.prev.number, wordId: p.prev.word_id, gapBucket: p.prev.gap_bucket } : null,
    verdict: r.verdict,
    minted: BigInt(r.minted),
  };
}
export async function getParams(): Promise<Params> {
  const p = await view<Wire>('get_params');
  return {
    playFee: BigInt(p.play_fee),
    feeSplitBps: p.fee_split_bps,
    wrongReturnBps: p.wrong_return_bps,
    solvedSplitBps: p.solved_split_bps,
    unsolvedSplitBps: p.unsolved_split_bps,
    storagePerPlay: BigInt(p.storage_charge_per_play),
    storagePerAccount: BigInt(p.storage_charge_account),
    stakeBps: p.stake_bps,
    stakeMin: BigInt(p.stake_min),
    baseAttempts: p.base_attempts,
    attemptCap: p.attempt_cap,
    shareCap: p.share_cap,
    lockTiers: p.lock_tiers.map((t: Wire) => ({ amount: BigInt(t.amount), extraAttempts: t.extra_attempts })),
    maxTeamSize: p.max_team_size,
    mintBase: BigInt(p.mint_base),
    roundAllowance: BigInt(p.round_allowance),
    revealWindowMs: ms(p.reveal_window_ns)!,
    investigationMaxMs: ms(p.investigation_max_ns)!,
    minRevealDelayBlocks: p.min_reveal_delay_blocks,
    refereeHash: p.referee.hash,
    refereeUrls: p.referee.urls,
    token: p.token,
    demo: p.demo,
  };
}
export const getWords = () => view<string[]>('get_word_list');
export async function getRound(mode: Mode, id?: number): Promise<Round | null> {
  const r = await view<Wire | null>('get_round', { mode, id: id ?? null });
  return r ? decodeRound(r) : null;
}
export async function getActiveRounds(): Promise<Round[]> {
  return (await view<Wire[]>('get_active_rounds')).map(decodeRound);
}
export const getNextSlot = (mode: Mode) =>
  view<{ round_id: number; slot_ns: number }>('get_next_slot', { mode });
export async function getLog(
  mode: Mode,
  id: number,
  fromIdx: number,
  limit: number,
  words: string[],
): Promise<LogRow[]> {
  return (await view<Wire[]>('get_log', { mode, id, from_idx: fromIdx, limit })).map(r =>
    decodeLogRow(r, words),
  );
}
export interface WirePlay {
  number: number;
  word_id: number;
  minute_digit: number;
  prev: { number: number; word_id: number; gap_bucket: number } | null;
}
export async function getVerdict(
  mode: Mode,
  id: number,
  play: WirePlay,
  words: string[],
): Promise<LogRow | null> {
  const r = await view<Wire | null>('get_verdict', { mode, id, play });
  return r ? decodeLogRow(r, words) : null;
}
export async function getEntity(mode: Mode, id: number, account: string, words: string[]): Promise<Entity> {
  const e = await view<Wire>('get_entity', { mode, id, account });
  if (e.line && typeof words[e.line.word_id] !== 'string')
    throw new Error('Entity references an unknown word');
  return {
    attempts: e.attempts,
    limit: e.limit,
    shares: e.shares,
    pending: e.pending,
    line: e.line
      ? {
          number: e.line.number,
          wordId: e.line.word_id,
          word: words[e.line.word_id]!,
          atMs: ms(e.line.timestamp)!,
        }
      : null,
  };
}
export async function getPlayer(account: string): Promise<Player | null> {
  const p = await view<Wire | null>('get_player', { account });
  return p
    ? {
        credit: BigInt(p.credit),
        pendingPlay: p.pending_play,
        pendingWithdrawal: p.pending_withdrawal,
        checkingGuesses: p.checking_guesses,
        teamId: p.team_id,
      }
    : null;
}
export async function getCommits(mode: Mode, id: number): Promise<Commit[]> {
  const rows: Commit[] = [];
  for (let from = 0; ; from += 200) {
    const page = await view<Wire[]>('get_commits', { mode, id, from, limit: 200 });
    rows.push(
      ...page.map(c => ({
        commitSeq: c.commit_seq,
        seq: c.seq,
        entityTag: c.entity_tag,
        entityId: c.entity_id,
        actor: c.actor,
        hash: c.hash,
        stake: BigInt(c.stake),
        block: c.block,
        status: c.status,
      })),
    );
    if (page.length < 200) return rows;
  }
}
export async function getTeam(teamId: number): Promise<Team | null> {
  const t = await view<Wire | null>('get_team', { team_id: teamId });
  return t
    ? {
        teamId: t.team_id,
        name: t.name,
        captain: t.captain,
        members: t.members,
        invites: t.invites,
        vault: BigInt(t.vault),
        weight: BigInt(t.weight),
        deposits: t.deposits.map((d: Wire) => ({ account: d.account, weight: BigInt(d.weight) })),
        activeRound: t.active_round,
      }
    : null;
}
export async function getClaimable(mode: Mode, roundId: number, account: string): Promise<bigint> {
  return BigInt(await view<string>('get_claimable', { mode, round_id: roundId, account }));
}
export async function getLock(mode: Mode, roundId: number, account: string): Promise<bigint> {
  return BigInt(await view<string>('get_lock', { mode, round_id: roundId, account }));
}
export async function getRuleBalance(account: string): Promise<bigint> {
  return BigInt(await view<string>('ft_balance_of', { account_id: account }, active.token));
}
export async function getSeason(mode: Mode, season: number): Promise<SeasonBoard> {
  try {
    return await readSeasonPages(
      () => view<SeasonStatus>('get_season_status', { mode, season }),
      (from, limit) => view<SeasonRow[]>('get_season', { mode, season, from, limit }),
    );
  } catch (e) {
    if (e instanceof MethodNotFound) return { supported: false };
    // Indexing can restart between the readiness view and a page read. E50 is not a generic failure.
    if (e instanceof RpcError && /\bE50\b/.test(JSON.stringify(e.detail))) {
      return {
        supported: true,
        ready: false,
        status: await view<SeasonStatus>('get_season_status', { mode, season }),
      };
    }
    throw e;
  }
}
export const getLedger = () => view<Wire>('get_ledger');

interface WireTokenOperation {
  operation_id: number;
  kind: TokenOperation['kind'];
  account_id: string;
  amount: string;
}

export function decodeTokenOperation(operation: WireTokenOperation): TokenOperation {
  if (!Number.isSafeInteger(operation.operation_id) || operation.operation_id < 0) {
    throw new Error('Invalid token operation ID');
  }
  if (operation.kind !== 'mint' && operation.kind !== 'unlock') {
    throw new Error('Invalid token operation kind');
  }
  if (
    typeof operation.account_id !== 'string' ||
    !operation.account_id ||
    typeof operation.amount !== 'string' ||
    !/^\d+$/.test(operation.amount)
  ) {
    throw new Error('Invalid token operation payload');
  }
  return {
    operationId: operation.operation_id,
    kind: operation.kind,
    accountId: operation.account_id,
    amount: BigInt(operation.amount),
  };
}

export async function getTokenOperation(requestId: number): Promise<TokenOperation | null> {
  if (!Number.isSafeInteger(requestId) || requestId < 0) throw new Error('Invalid token operation ID');
  const operation = await view<WireTokenOperation | null>('get_token_operation', { request_id: requestId });
  return operation ? decodeTokenOperation(operation) : null;
}

export async function getTokenOutcome(operationId: number): Promise<TokenOutcome | null> {
  if (!Number.isSafeInteger(operationId) || operationId < 0) throw new Error('Invalid token operation ID');
  const result = await view<{ operation: WireTokenOperation; status: TokenOutcome['status'] } | null>(
    'get_operation',
    { operation_id: operationId },
    active.token,
  );
  if (!result) return null;
  const statuses: TokenOutcome['status'][] = [
    'applied',
    'receiver_unregistered',
    'insufficient_balance',
    'cap_exceeded',
    'invalid_amount',
  ];
  if (!statuses.includes(result.status)) throw new Error('Invalid token operation status');
  return { operation: decodeTokenOperation(result.operation), status: result.status };
}

export interface TokenStorageBalance {
  total: string;
  available: string;
}
export const getTokenStorage = (account: string) =>
  view<TokenStorageBalance | null>('storage_balance_of', { account_id: account }, active.token);
export async function getTokenStorageMinimum(): Promise<bigint> {
  const bounds = await view<{ min: string; max: string | null }>('storage_balance_bounds', {}, active.token);
  if (!/^\d+$/.test(bounds.min)) throw new Error('Invalid token storage minimum');
  return BigInt(bounds.min);
}
export async function getTokenState(account: string): Promise<'none' | 'pending' | 'registered'> {
  const state = await view<string>('get_token_state', { account });
  if (state !== 'none' && state !== 'pending' && state !== 'registered')
    throw new Error('Invalid token registration state');
  return state;
}
