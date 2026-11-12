import { describe, expect, it } from 'vitest';
import { digitsToNumber, pasteDigits, reelAction } from './reelInput';

describe('reelAction', () => {
  it('a typed digit fills the slot and moves on, staying on the last slot', () => {
    expect(reelAction('5', 0)).toEqual({ type: 'set', digit: 5, focus: 1 });
    expect(reelAction('0', 1)).toEqual({ type: 'set', digit: 0, focus: 2 });
    expect(reelAction('9', 2)).toEqual({ type: 'set', digit: 9, focus: 2 });
  });

  it.each([' ', 'Enter', 'ArrowRight'])('%j moves to the next slot', key => {
    expect(reelAction(key, 0)).toEqual({ type: 'focus', slot: 1 });
    expect(reelAction(key, 1)).toEqual({ type: 'focus', slot: 2 });
  });

  it('Space and ArrowRight are handled on the last slot, Enter is left to the page', () => {
    expect(reelAction(' ', 2)).toEqual({ type: 'focus', slot: 2 });
    expect(reelAction('ArrowRight', 2)).toEqual({ type: 'focus', slot: 2 });
    expect(reelAction('Enter', 2)).toBeNull();
  });

  it.each(['Backspace', 'ArrowLeft'])('%s goes back and stops at the first slot', key => {
    expect(reelAction(key, 2)).toEqual({ type: 'focus', slot: 1 });
    expect(reelAction(key, 0)).toEqual({ type: 'focus', slot: 0 });
  });

  it('ArrowUp and ArrowDown step the digit', () => {
    expect(reelAction('ArrowUp', 1)).toEqual({ type: 'step', by: 1 });
    expect(reelAction('ArrowDown', 1)).toEqual({ type: 'step', by: -1 });
  });

  it('ignores everything else', () => {
    for (const key of ['a', 'Tab', 'Shift', '-', '10', 'Escape']) expect(reelAction(key, 1)).toBeNull();
  });
});

describe('pasteDigits', () => {
  it('a three-digit paste fills all slots from any slot', () => {
    expect(pasteDigits('516', 0, [4, 1, 7])).toEqual({ digits: [5, 1, 6], focus: 2 });
    expect(pasteDigits('516', 2, [4, 1, 7])).toEqual({ digits: [5, 1, 6], focus: 2 });
  });

  it('takes the first three digits of a longer paste and ignores other characters', () => {
    expect(pasteDigits(' 5-1 6 99', 1, [0, 0, 0])).toEqual({ digits: [5, 1, 6], focus: 2 });
  });

  it('a short paste fills from the focused slot and stops at the last', () => {
    expect(pasteDigits('8', 1, [4, 1, 7])).toEqual({ digits: [4, 8, 7], focus: 2 });
    expect(pasteDigits('83', 1, [4, 1, 7])).toEqual({ digits: [4, 8, 3], focus: 2 });
    expect(pasteDigits('3', 2, [4, 1, 7])).toEqual({ digits: [4, 1, 3], focus: 2 });
  });

  it('does not touch the input when there is no digit', () => {
    expect(pasteDigits('abc', 0, [4, 1, 7])).toBeNull();
    expect(pasteDigits('', 0, [4, 1, 7])).toBeNull();
  });
});

describe('digitsToNumber', () => {
  it('reads the slots as one number', () => {
    expect(digitsToNumber([0, 0, 0])).toBe(0);
    expect(digitsToNumber([5, 1, 6])).toBe(516);
    expect(digitsToNumber([9, 9, 9])).toBe(999);
  });
});
