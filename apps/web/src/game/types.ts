/**
 * Domain types the screens consume. Decoded from chain views by `src/chain`, never invented.
 * Amounts are bigint (yoctoNEAR or RULE base units, 18 decimals). Times are epoch milliseconds.
 * Owner: lead (interface). Implementation: src/chain + src/game.
 */

export type Mode = 0 | 1;
export const SOLO: Mode = 0;
export const TEAM: Mode = 1;

export type Phase =
  'Scheduled' | 'Sealing' | 'Investigation' | 'Reveal' | 'Opening' | 'Settled' | 'Cancelled' | 'Void';

/** Canonical rule exactly as returned by the chain after the reveal (rule-core JSON). */
export interface CanonicalRule {
  v: string;
  form: number;
  lits: [number, number][];
}

export type RoundOutcome =
  | { kind: 'Solved'; account: string; entityTag: number; entityId: number }
  | { kind: 'Unsolved' }
  | { kind: 'Cancelled' }
  | { kind: 'Void' };

export interface Round {
  mode: Mode;
  roundId: number;
  phase: Phase;
  /** Chain flag. Never decides the user-facing label alone; see config.deploymentLabel. */
  demo: boolean;
  /** sha256(canonical_rule || salt), hex. Null before begin succeeds. */
  commit: string | null;
  header: { tier: string; bucket: string; grammar: string } | null;
  seed: string | null;
  pot: bigint;
  allowanceLeft: bigint;
  logLen: number;
  pendingChecks: number;
  sealedAtMs: number | null;
  investigationEndMs: number | null;
  freezeMs: number | null;
  revealDeadlineMs: number | null;
  outcome: RoundOutcome | null;
  /** Present only after the authorized reveal. */
  rule: CanonicalRule | null;
  salt: string | null;
}

export interface PlayInput {
  number: number; // 0..999
  word: string; // from the published word list
}

export interface LogRow {
  logIdx: number;
  seq: number;
  playKey: string;
  entityTag: number;
  entityId: number;
  account: string;
  actor: number;
  number: number;
  wordId: number;
  word: string;
  minuteDigit: number;
  prev: { number: number; wordId: number; gapBucket?: number } | null;
  verdict: boolean;
  minted: bigint;
}

export interface EntityLine {
  number: number;
  wordId: number;
  word: string;
  atMs: number;
}

export interface Entity {
  attempts: number;
  limit: number;
  shares: number;
  /** The entity's play flag only. Says nothing about payment completion. */
  pending: boolean;
  line: EntityLine | null;
}

export interface Player {
  credit: bigint;
  pendingPlay: boolean;
  pendingWithdrawal: boolean;
  checkingGuesses: number;
  teamId: number | null;
}

export type CommitStatus = 'Committed' | 'Checking' | 'Correct' | 'Wrong' | 'Refunded' | 'Unrevealed';

export interface Commit {
  commitSeq: number;
  seq: number;
  entityTag: number;
  entityId: number;
  actor: string;
  hash: string;
  stake: bigint;
  block: number;
  status: CommitStatus;
}

export interface Params {
  playFee: bigint;
  /** Share of one play fee, in basis points: [pot, compute float, platform]. */
  feeSplitBps: [number, number, number];
  /** Share of a wrong or unrevealed stake returned to the guesser, in basis points. */
  wrongReturnBps: number;
  /** Final pot when solved, in basis points: [winner, contributors, rollover, platform]. */
  solvedSplitBps: [number, number, number, number];
  /** Final pot when unsolved, in basis points: [contributors, rollover, platform]. */
  unsolvedSplitBps: [number, number, number];
  storagePerPlay: bigint;
  storagePerAccount: bigint;
  stakeBps: [number, number];
  stakeMin: bigint;
  baseAttempts: [number, number];
  attemptCap: [number, number];
  shareCap: [number, number];
  lockTiers: { amount: bigint; extraAttempts: number }[];
  maxTeamSize: number;
  mintBase: bigint;
  roundAllowance: bigint;
  revealWindowMs: number;
  investigationMaxMs: number;
  minRevealDelayBlocks: number;
  refereeHash: string;
  refereeUrls: string[];
  token: string;
  demo: boolean;
}

/** A user-facing error: always says what happened, whether money moved, and the next step. */
export interface UiError {
  /** Contract panic code when known, e.g. "E14". */
  code: string | null;
  title: string;
  /** Plain sentence about funds: "Nothing was charged." or "Your fee is refunded." */
  funds: string;
  next: string;
  retryable: boolean;
}

/**
 * Play lifecycle for one stamp. A pending request is never a verdict.
 * idle -> prechecking -> (known | signing) -> pending -> (accepted | rejected | refunded) ; any -> error
 */
export type PlayState =
  | { kind: 'idle' }
  | { kind: 'prechecking'; input: PlayInput }
  | { kind: 'known'; input: PlayInput; row: LogRow }
  | { kind: 'signing'; input: PlayInput }
  | { kind: 'pending'; input: PlayInput; txHash: string | null; sinceMs: number }
  | { kind: 'accepted'; input: PlayInput; row: LogRow; txHash: string | null }
  | { kind: 'rejected'; input: PlayInput; row: LogRow; txHash: string | null }
  | { kind: 'refunded'; input: PlayInput; txHash: string | null }
  | { kind: 'error'; input: PlayInput | null; error: UiError };

/** Generic async action state for deposits, withdrawals, commits, claims, team actions. */
export type ActionState<T = unknown> =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'pending'; txHash: string | null }
  | { kind: 'done'; txHash: string | null; value: T }
  | { kind: 'error'; error: UiError };

export interface ReplayResult {
  pass: boolean;
  commitmentOk: boolean;
  matched: number;
  total: number;
  logComplete: boolean;
  /** First failing check in plain words, when pass is false. */
  firstFailure: string | null;
}

export type ReplayState =
  | { kind: 'idle' }
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'running' }
  | { kind: 'done'; result: ReplayResult; elapsedMs: number }
  | { kind: 'error'; error: UiError };

export interface RuleText {
  english: string;
  dsl: string;
  json: string;
}

export interface WalletState {
  status: 'loading' | 'disconnected' | 'connecting' | 'connected';
  accountId: string | null;
}

export interface Team {
  teamId: number;
  name: string;
  captain: string;
  members: string[];
  invites: string[];
  vault: bigint;
  weight: bigint;
  deposits: { account: string; weight: bigint }[];
  activeRound: number | null;
}

export interface SavedGuess {
  round: number;
  mode: Mode;
  guess: CanonicalRule;
  salt: string;
  commitSeq: number;
}

export interface TokenOperation {
  operationId: number;
  kind: 'mint' | 'unlock';
  accountId: string;
  amount: bigint;
}

export interface TokenOutcome {
  operation: TokenOperation;
  status: 'applied' | 'receiver_unregistered' | 'insufficient_balance' | 'cap_exceeded' | 'invalid_amount';
}
