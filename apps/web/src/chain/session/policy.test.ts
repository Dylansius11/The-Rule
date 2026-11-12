import { describe, expect, it } from 'vitest';
import {
  CALL_ALLOWANCE_COST,
  LOW_ALLOWANCE,
  SESSION_METHODS,
  assessKey,
  routeCall,
  type OnChainKey,
} from './policy';

const GAME = 'demo-game.therule.testnet';
const TOKEN = 'demo-token.therule.testnet';

const key = (over: Partial<{ allowance: string | null; receiver_id: string; method_names: string[] }> = {}) =>
  ({
    nonce: 1,
    permission: {
      FunctionCall: {
        allowance: '500000000000000000000000',
        receiver_id: GAME,
        method_names: [...SESSION_METHODS],
        ...over,
      },
    },
  }) satisfies OnChainKey;

describe('routeCall', () => {
  it('signs every listed zero-deposit game method locally', () => {
    for (const methodName of SESSION_METHODS) {
      expect(routeCall({ receiverId: GAME, methodName, deposit: 0n }, GAME)).toBe('session');
    }
  });

  it('sends anything carrying a deposit to the wallet, even a listed method', () => {
    expect(routeCall({ receiverId: GAME, methodName: 'play', deposit: 1n }, GAME)).toBe('wallet');
  });

  it('keeps the deposit-bearing game methods with the wallet', () => {
    for (const methodName of [
      'deposit_credit',
      'withdraw_credit',
      'unlock',
      'team_deposit',
      'team_withdraw',
    ]) {
      expect(routeCall({ receiverId: GAME, methodName, deposit: 0n }, GAME)).toBe('wallet');
    }
  });

  it('never signs for the token contract or another contract', () => {
    expect(routeCall({ receiverId: TOKEN, methodName: 'ft_transfer_call', deposit: 0n }, GAME)).toBe(
      'wallet',
    );
    expect(routeCall({ receiverId: TOKEN, methodName: 'play', deposit: 0n }, GAME)).toBe('wallet');
  });
});

describe('assessKey', () => {
  it('is off when the key is not on the account', () => {
    expect(assessKey(null, GAME).status).toBe('off');
  });

  it('is active with a healthy allowance and reports it', () => {
    const result = assessKey(key(), GAME);
    expect(result.status).toBe('active');
    expect(result.allowance).toBe(500_000_000_000_000_000_000_000n);
    expect(result.reason).toBeNull();
  });

  it('flags a low allowance but still allows signing', () => {
    expect(assessKey(key({ allowance: (LOW_ALLOWANCE - 1n).toString() }), GAME).status).toBe('low');
  });

  it('is off once one more call cannot be paid for', () => {
    const result = assessKey(key({ allowance: (CALL_ALLOWANCE_COST - 1n).toString() }), GAME);
    expect(result.status).toBe('off');
    expect(result.allowance).toBe(CALL_ALLOWANCE_COST - 1n);
  });

  it('treats an unlimited allowance as active', () => {
    expect(assessKey(key({ allowance: null }), GAME).status).toBe('active');
  });

  it('refuses a key for another contract, a full-access key, or a stale method list', () => {
    expect(assessKey(key({ receiver_id: 'game-r2.therule.testnet' }), GAME).status).toBe('off');
    expect(assessKey({ nonce: 1, permission: 'FullAccess' }, GAME).status).toBe('off');
    expect(assessKey(key({ method_names: ['play'] }), GAME).status).toBe('off');
    // On NEAR an empty list means every method, which is wider than this app asked for.
    expect(assessKey(key({ method_names: [] }), GAME).status).toBe('off');
  });
});
