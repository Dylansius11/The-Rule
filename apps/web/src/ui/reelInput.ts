/** Pure keyboard and paste rules for the three-slot number reel. No DOM: `ReelNumber` applies the result. */

export const SLOTS = 3;

export type ReelAction =
  /** A digit was typed: show it and move to `focus`. */
  | { type: 'set'; digit: number; focus: number }
  /** ArrowUp / ArrowDown: change this slot's digit by one. */
  | { type: 'step'; by: 1 | -1 }
  /** Move focus to a slot (staying put counts: the key is handled, not left to the browser). */
  | { type: 'focus'; slot: number };

/**
 * What a key does in `slot`, or null when the key is not the reel's (letters, Tab, Enter on the last slot,
 * shortcuts). A digit fills the slot and moves on; Space, Enter and ArrowRight move on; Backspace and ArrowLeft
 * go back; ArrowUp and ArrowDown change the digit.
 */
export function reelAction(key: string, slot: number, slots: number = SLOTS): ReelAction | null {
  const last = slots - 1;
  if (/^[0-9]$/.test(key)) return { type: 'set', digit: Number(key), focus: Math.min(slot + 1, last) };
  switch (key) {
    case 'ArrowUp':
      return { type: 'step', by: 1 };
    case 'ArrowDown':
      return { type: 'step', by: -1 };
    case ' ':
    case 'Spacebar':
    case 'ArrowRight':
      return { type: 'focus', slot: Math.min(slot + 1, last) };
    case 'Enter':
      return slot < last ? { type: 'focus', slot: slot + 1 } : null;
    case 'Backspace':
    case 'ArrowLeft':
      return { type: 'focus', slot: Math.max(slot - 1, 0) };
    default:
      return null;
  }
}

/**
 * Pasted text into `slot`. Only digits count. A full number (as many digits as slots, or more) fills every slot
 * from the first; fewer digits fill from `slot` onward and stop at the last slot. Null when there is no digit.
 */
export function pasteDigits(
  text: string,
  slot: number,
  current: readonly number[],
): { digits: number[]; focus: number } | null {
  const typed = text.replace(/\D/g, '');
  if (typed === '') return null;
  const slots = current.length;
  const from = typed.length >= slots ? 0 : slot;
  const digits = [...current];
  let at = from;
  for (const ch of typed) {
    if (at >= slots) break;
    digits[at++] = Number(ch);
  }
  return { digits, focus: Math.min(at, slots - 1) };
}

/** A three-digit array back to 0..999. */
export const digitsToNumber = (digits: readonly number[]): number =>
  digits.reduce((total, digit) => total * 10 + digit, 0);
