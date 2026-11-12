import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useReduced } from '@/motion/prefs';
import { InkBox } from './InkBox';
import { digitsToNumber, pasteDigits, reelAction, SLOTS } from './reelInput';

const TRI = 'M5 27 L22 5 L39 27 Z';

interface ReelProps {
  digit: number;
  label: string;
  onChange: (digit: number) => void;
  disabled?: boolean;
  /** Which slot this wheel is, for typing across the three wheels. Omit for a lone wheel. */
  slot?: number;
  /** Move focus to another wheel (typing, Space, Enter, arrows, Backspace). */
  onFocusSlot?: (slot: number) => void;
  /** Digits pasted into this wheel. */
  onPasteText?: (text: string, slot: number) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}

/**
 * One digit wheel: up/down buttons, typed digit, arrow keys. The digit rolls in from above or below. Typing a
 * digit, Space, Enter or ArrowRight moves on to the next wheel; Backspace and ArrowLeft go back.
 */
export function Reel({
  digit,
  label,
  onChange,
  disabled,
  slot,
  onFocusSlot,
  onPasteText,
  inputRef,
}: ReelProps) {
  const box = useRef<HTMLElement>(null);
  const reduced = useReduced();

  function set(next: number, dir: 1 | -1) {
    onChange(((next % 10) + 10) % 10);
    if (reduced) return;
    box.current?.querySelector('input')?.animate(
      [
        { transform: `translateY(${dir > 0 ? 60 : -60}%)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = reelAction(e.key, slot ?? 0, slot === undefined ? 1 : SLOTS);
    if (!action) return;
    e.preventDefault();
    if (action.type === 'step') set(digit + action.by, action.by);
    else if (action.type === 'set') {
      set(action.digit, 1);
      if (slot !== undefined) onFocusSlot?.(action.focus);
    } else if (slot !== undefined) onFocusSlot?.(action.slot);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (slot !== undefined && onPasteText) onPasteText(text, slot);
    else {
      const ch = text.replace(/\D/g, '')[0];
      if (ch !== undefined) set(Number(ch), 1);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        className="reel-tri"
        aria-label={`Increase ${label}`}
        disabled={disabled}
        onClick={() => set(digit + 1, 1)}
      >
        <svg viewBox="0 0 44 32" aria-hidden="true">
          <path d={TRI} />
        </svg>
      </button>
      <InkBox ref={box} fill="#fff" className="reel-digit">
        <input
          ref={inputRef}
          inputMode="numeric"
          pattern="[0-9]"
          autoComplete="off"
          aria-label={`${label} digit`}
          value={digit}
          disabled={disabled}
          onFocus={e => e.currentTarget.select()}
          onKeyDown={onKey}
          onPaste={onPaste}
          onChange={e => {
            // Soft keyboards report no key; their digit arrives here.
            const ch = e.target.value.replace(/\D/g, '').slice(-1);
            if (ch === '') return;
            set(Number(ch), 1);
            if (slot !== undefined) onFocusSlot?.(Math.min(slot + 1, SLOTS - 1));
          }}
        />
      </InkBox>
      <button
        type="button"
        className="reel-tri"
        aria-label={`Decrease ${label}`}
        disabled={disabled}
        onClick={() => set(digit - 1, -1)}
      >
        <svg viewBox="0 0 44 32" aria-hidden="true" style={{ transform: 'scaleY(-1)' }}>
          <path d={TRI} />
        </svg>
      </button>
    </div>
  );
}

interface ReelNumberProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/** Three reels for 000 to 999. Hundreds, tens, units. Type 516, or paste it, or use the triangles. */
export function ReelNumber({ value, onChange, disabled }: ReelNumberProps) {
  const digits = String(Math.min(999, Math.max(0, value)))
    .padStart(3, '0')
    .split('')
    .map(Number);
  const labels = ['hundreds', 'tens', 'units'] as const;
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusSlot = (slot: number) => inputs.current[slot]?.focus();

  return (
    <div role="group" aria-label="Number, 000 to 999" className="flex items-center gap-2.5 xs:gap-4">
      {digits.map((d, i) => (
        <Reel
          key={labels[i]}
          digit={d}
          label={labels[i] ?? ''}
          disabled={disabled}
          slot={i}
          inputRef={el => {
            inputs.current[i] = el;
          }}
          onFocusSlot={focusSlot}
          onPasteText={(text, at) => {
            const pasted = pasteDigits(text, at, digits);
            if (!pasted) return;
            onChange(digitsToNumber(pasted.digits));
            focusSlot(pasted.focus);
          }}
          onChange={next => {
            const copy = [...digits];
            copy[i] = next;
            onChange(digitsToNumber(copy));
          }}
        />
      ))}
    </div>
  );
}
