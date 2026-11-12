import { describe, expect, it } from 'vitest';
import { MAKE_DEFAULT_GAME, verifyCommand } from './command';

describe('verifyCommand', () => {
  it('leaves out the account when it is the Makefile default', () => {
    expect(verifyCommand('solo', 3, MAKE_DEFAULT_GAME)).toBe('make verify ROUND=solo/3');
  });

  it('names any other game account', () => {
    expect(verifyCommand('team', 345, 'demo-game.therule.testnet')).toBe(
      'make verify ROUND=team/345 GAME_ACCOUNT=demo-game.therule.testnet',
    );
  });
});
