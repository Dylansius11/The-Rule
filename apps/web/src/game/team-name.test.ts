import { describe, expect, it } from 'vitest';
import { validTeamName } from './team-name';

describe('contract team names', () => {
  it.each(['abc', 'sandbox-ink', '123', '---', 'a'.repeat(24)])('accepts %s', name => {
    expect(validTeamName(name)).toBe(true);
  });
  it.each([
    '',
    'ab',
    'a'.repeat(25),
    'Sandbox ink',
    'Ink Gang',
    'abc_',
    ' abc',
    'abc ',
    'éab',
    'ａｂｃ',
    'abc\n',
  ])('blocks %s before signing', name => {
    expect(validTeamName(name)).toBe(false);
  });
});
