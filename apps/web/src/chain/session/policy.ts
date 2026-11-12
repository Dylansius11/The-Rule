/**
 * Session key policy: which calls may be signed locally with a function-call key, how big its gas
 * allowance is, and how an on-chain key maps to a user-visible status. Pure: no I/O, no wallet.
 *
 * A NEAR function-call key cannot attach a deposit, so any call carrying one always goes to the wallet.
 */

/**
 * Zero-deposit game methods, each checked against contracts/game/src (none is #[payable]).
 * Deliberately excluded: deposit_credit, withdraw_credit, unlock, team_deposit, team_withdraw
 * (all carry a deposit) and everything on the token contract.
 */
export const SESSION_METHODS = [
  'play',
  'commit_guess',
  'reveal_guess',
  'claim',
  'claim_team',
  'register_token',
  'settle_team',
  'create_team',
  'invite',
  'join_team',
  'leave_team',
  'remove_member',
  'retry_token_operation',
] as const;

const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;

/**
 * Gas allowance granted to the key, in yoctoNEAR. play and reveal_guess prepay 300 Tgas, which at the
 * testnet gas price (1e8 yocto per gas) debits 0.03 NEAR each, so 0.5 NEAR covers about 16 of them.
 */
export const SESSION_ALLOWANCE = YOCTO_PER_NEAR / 2n;
/** One heavy call. Below this the key cannot sign another one. */
export const CALL_ALLOWANCE_COST = (YOCTO_PER_NEAR * 3n) / 100n;
/** Below this the status is flagged so the player can renew before the key runs dry. */
export const LOW_ALLOWANCE = CALL_ALLOWANCE_COST * 3n;

export type CallRoute = 'session' | 'wallet';

export interface CallShape {
  receiverId: string;
  methodName: string;
  deposit: bigint;
}

/** Deposit or unlisted method or any contract other than the game: the wallet decides. */
export function routeCall(call: CallShape, game: string): CallRoute {
  if (call.deposit !== 0n) return 'wallet';
  if (call.receiverId !== game) return 'wallet';
  return (SESSION_METHODS as readonly string[]).includes(call.methodName) ? 'session' : 'wallet';
}

/** Shape of `view_access_key` as far as we read it. */
export interface OnChainKey {
  nonce: number | string;
  permission:
    | 'FullAccess'
    | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
}

export type SessionStatus = 'unsupported' | 'off' | 'checking' | 'active' | 'low';

export interface KeyAssessment {
  status: 'off' | 'active' | 'low';
  /** Remaining gas allowance in yoctoNEAR, null when unknown or unlimited. */
  allowance: bigint | null;
  /** Why the key is not usable, in plain words. Null while it is. */
  reason: string | null;
}

/** Is the key on-chain, scoped to this game and the full method list, with allowance left? */
export function assessKey(key: OnChainKey | null, game: string): KeyAssessment {
  if (!key)
    return { status: 'off', allowance: null, reason: 'The key is not on your account. Enable it again.' };
  if (key.permission === 'FullAccess' || !('FunctionCall' in key.permission)) {
    return { status: 'off', allowance: null, reason: 'That key is not a function-call key.' };
  }
  const { receiver_id, method_names, allowance } = key.permission.FunctionCall;
  if (receiver_id !== game) {
    return { status: 'off', allowance: null, reason: 'The key belongs to a different contract.' };
  }
  // An empty method list means any method on NEAR; that is wider than we asked for, so reject it too.
  const covered = SESSION_METHODS.every(m => method_names.includes(m));
  if (!covered)
    return { status: 'off', allowance: null, reason: 'The key predates the current method list.' };
  if (allowance === null) return { status: 'active', allowance: null, reason: null };
  const left = BigInt(allowance);
  if (left < CALL_ALLOWANCE_COST) {
    return { status: 'off', allowance: left, reason: 'The key has used up its gas allowance.' };
  }
  return { status: left < LOW_ALLOWANCE ? 'low' : 'active', allowance: left, reason: null };
}

/** Why a local signature could not be used. Thrown only when the network definitively rejected it. */
export type RejectionKind = 'key-missing' | 'allowance' | 'nonce' | 'invalid-key';

/**
 * A key rejection that happened before the transaction was included in a block, so nothing ran and
 * falling back to the wallet cannot double-spend. Anything else (timeout, network, unknown) is NOT
 * this class and must never trigger a fallback.
 */
export class SessionRejected extends Error {
  constructor(
    readonly kind: RejectionKind,
    readonly detail: unknown,
  ) {
    super(REJECTION_TEXT[kind]);
    this.name = 'SessionRejected';
  }
}

const REJECTION_TEXT: Record<RejectionKind, string> = {
  'key-missing': 'The session key is not on your account any more.',
  allowance: 'The session key used up its gas allowance.',
  nonce: 'The session key nonce was out of sync.',
  'invalid-key': 'The session key was rejected by the network.',
};
