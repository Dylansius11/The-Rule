import type { UiError } from '@/game/types';
import { isRateLimited, isUnreachable, RpcError } from './rpc';

const noCharge = 'No game charge was applied; transaction gas may apply.';
const retry = 'Check the round and try again when the action is available.';
const messages: Record<string, Pick<UiError, 'title' | 'funds' | 'next'>> = {
  E10: { title: 'The round is not in the right phase', funds: noCharge, next: retry },
  E11: {
    title: 'The input is invalid',
    funds: noCharge,
    next: 'Check the field constraints. Team names need 3–24 ASCII lowercase letters, digits or hyphens.',
  },
  E12: { title: 'That play is already pending', funds: noCharge, next: retry },
  E13: { title: 'A play is already pending', funds: noCharge, next: retry },
  E14: { title: 'The attempt limit was reached', funds: noCharge, next: retry },
  E15: { title: 'Three guesses are already open', funds: noCharge, next: retry },
  E16: { title: 'The reveal deadline has passed', funds: noCharge, next: retry },
  E17: { title: 'Only the original actor can reveal', funds: noCharge, next: retry },
  E18: { title: 'The reveal is too early', funds: noCharge, next: 'Wait for more blocks and try again.' },
  E19: { title: 'The guess does not match its commitment', funds: noCharge, next: retry },
  E20: {
    title: 'There is not enough credit or vault balance',
    funds: noCharge,
    next: 'Add credit or fund the team vault, then try again.',
  },
  E21: { title: 'A withdrawal, play or guess check is pending', funds: noCharge, next: retry },
  E22: { title: 'The referee compute balance is insufficient', funds: noCharge, next: retry },
  E23: { title: 'The referee is at capacity', funds: noCharge, next: retry },
  E24: { title: 'The operator storage reserve is insufficient', funds: noCharge, next: retry },
  E30: {
    title: 'The team is locked',
    funds: noCharge,
    next: 'The team is still tied to an earlier round. Press “Claim all” on the Team desk or the Account page to unlock it, then try again.',
  },
  E31: { title: 'The team is full', funds: noCharge, next: retry },
  E32: { title: 'You are not in a team', funds: noCharge, next: retry },
  E33: { title: 'This action requires an invitation or captain permission', funds: noCharge, next: retry },
  E40: { title: 'The token is not authorized', funds: noCharge, next: retry },
  E41: { title: 'The lock target is not available', funds: noCharge, next: retry },
  E50: { title: 'The operation is not available yet', funds: noCharge, next: retry },
  E51: { title: 'Exactly one yoctoNEAR is required', funds: noCharge, next: retry },
  E52: { title: 'The token account is not registered', funds: noCharge, next: retry },
  E53: { title: 'Forced token unregister is unavailable', funds: noCharge, next: retry },
  E54: { title: 'Only the minter can do that', funds: noCharge, next: retry },
  E55: { title: 'The token cap would be exceeded', funds: noCharge, next: retry },
  E56: { title: 'There is nothing to claim', funds: noCharge, next: retry },
  E57: { title: 'A token registration check is already pending', funds: noCharge, next: retry },
};

export type LocalPlayErrorKind = 'wallet' | 'round' | 'input' | 'precheck';

export class LocalPlayError extends Error {
  constructor(readonly kind: LocalPlayErrorKind) {
    super(kind);
    this.name = 'LocalPlayError';
  }
}

export class UnknownPlayAcknowledgement extends Error {
  constructor(readonly txHash: string | null) {
    super('The play acknowledgement could not be read');
    this.name = 'UnknownPlayAcknowledgement';
  }
}

const localPlayErrors: Record<LocalPlayErrorKind, Pick<UiError, 'title' | 'next'>> = {
  wallet: { title: 'Wallet not connected', next: 'Connect a wallet.' },
  round: { title: 'Round not open', next: 'This round is not open for plays.' },
  input: { title: 'Invalid play', next: 'Pick a number 000-999 and a listed word.' },
  precheck: { title: 'Could not check the play', next: 'Check your connection and try again.' },
};

export function toUiError(error: unknown): UiError {
  if (error instanceof LocalPlayError) {
    return {
      code: null,
      ...localPlayErrors[error.kind],
      funds: 'Nothing was sent. Nothing was charged.',
      retryable: true,
    };
  }
  if (error instanceof UnknownPlayAcknowledgement) {
    return {
      code: null,
      title: 'Play result not yet known',
      funds: 'The transaction was sent; its game charge and result are not yet known.',
      next: `Check the round log before trying again.${error.txHash ? ` Transaction: ${error.txHash}.` : ''}`,
      retryable: false,
    };
  }
  const detail = error instanceof Error ? (error as Error & { detail?: unknown }).detail : undefined;
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(detail ?? '')}` : String(error);
  const code = /\bE(?:1[0-9]|2[0-4]|3[0-3]|4[01]|5[0-7])\b/.exec(text)?.[0] ?? null;
  if (
    !code &&
    /user (?:rejected|denied|cancelled|canceled)|wallet (?:closed|rejected)|request rejected by user/i.test(
      text,
    )
  ) {
    return {
      code: null,
      title: 'Wallet closed',
      funds: 'Nothing was charged. You closed the wallet.',
      next: 'Try again when you are ready.',
      retryable: true,
    };
  }
  if (code && messages[code]) return { code, ...messages[code], retryable: true };
  if (error instanceof RpcError) {
    // A failed read, not a failed transaction. The wording stays safe if it lands right after a send.
    return {
      code: null,
      title: isRateLimited(error)
        ? 'The chain data service is busy'
        : isUnreachable(error)
          ? 'Could not reach the chain'
          : 'Could not read the chain',
      funds:
        'Reading the chain never spends anything. If you just sent a transaction, check the ledger before sending it again.',
      next: isRateLimited(error)
        ? 'Too many requests reached the public node. Wait a few seconds and try again.'
        : isUnreachable(error)
          ? 'The public node may be busy, or your connection is down. Wait a few seconds and try again.'
          : 'Check your connection and try again.',
      retryable: true,
    };
  }
  return {
    code,
    title: 'Could not complete the request',
    funds:
      'Check your wallet and chain activity before trying again; the transaction outcome may be unknown.',
    next: retry,
    retryable: true,
  };
}
