import { describe, expect, it } from 'vitest';
import { LocalPlayError, toUiError, UnknownPlayAcknowledgement } from './errors';

describe('contract errors', () => {
  it('maps every documented panic code', () => {
    const codes = [
      'E10',
      'E11',
      'E12',
      'E13',
      'E14',
      'E15',
      'E16',
      'E17',
      'E18',
      'E19',
      'E20',
      'E21',
      'E22',
      'E23',
      'E24',
      'E30',
      'E31',
      'E32',
      'E33',
      'E40',
      'E41',
      'E50',
      'E51',
      'E52',
      'E53',
      'E54',
      'E55',
      'E56',
      'E57',
    ];
    for (const code of codes) {
      const error = toUiError(new Error(`panic ${code}`));
      expect(error.code).toBe(code);
      expect(error.funds).toBeTruthy();
      expect(error.next).toBeTruthy();
    }
  });

  it('explains wallet rejection', () => {
    expect(toUiError(new Error('User rejected request')).funds).toBe(
      'Nothing was charged. You closed the wallet.',
    );
  });

  it.each([
    ['wallet', 'Connect a wallet.'],
    ['round', 'This round is not open for plays.'],
    ['input', 'Pick a number 000-999 and a listed word.'],
    ['precheck', 'Check your connection and try again.'],
  ] as const)('reports %s before signing without a charge', (kind, next) => {
    const error = toUiError(new LocalPlayError(kind));
    expect(error.funds).toBe('Nothing was sent. Nothing was charged.');
    expect(error.next).toBe(next);
  });

  it('preserves the hash when the sent transaction has no usable acknowledgement', () => {
    const error = toUiError(new UnknownPlayAcknowledgement('tx123'));
    expect(error.funds).toContain('transaction was sent');
    expect(error.next).toContain('tx123');
    expect(error.next).toContain('round log');
    expect(error.retryable).toBe(false);
  });
});
