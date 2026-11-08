import { useRef, type KeyboardEvent } from 'react';
import { useReduced } from '@/motion/prefs';
import { InkBox } from './InkBox';

const TRI = 'M5 27 L22 5 L39 27 Z';

interface ReelProps {
  digit: number;
  label: string;
  onChange: (digit: number) => void;
  disabled?: boolean;
}

/** One digit wheel: up/down buttons, typed digit, arrow keys. The digit rolls in from above or below. */
export function Reel({ digit, label, onChange, disabled }: ReelProps) {
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
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      set(digit + 1, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      set(digit - 1, -1);
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
          inputMode="numeric"
          pattern="[0-9]"
          autoComplete="off"
          aria-label={`${label} digit`}
          value={digit}
          disabled={disabled}
          onFocus={e => e.currentTarget.select()}
          onKeyDown={onKey}
          onChange={e => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1);
            if (ch !== '') set(Number(ch), 1);
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

/** Three reels for 000 to 999. Hundreds, tens, units. */
export function ReelNumber({ value, onChange, disabled }: ReelNumberProps) {
  const digits = String(Math.min(999, Math.max(0, value)))
    .padStart(3, '0')
    .split('')
    .map(Number) as [number, number, number];
  const labels = ['hundreds', 'tens', 'units'] as const;
  return (
    <div role="group" aria-label="Number, 000 to 999" className="flex items-center gap-2.5 xs:gap-4">
      {digits.map((d, i) => (
        <Reel
          key={labels[i]}
          digit={d}
          label={labels[i] ?? ''}
          disabled={disabled}
          onChange={next => {
            const copy = [...digits];
            copy[i] = next;
            onChange(copy[0]! * 100 + copy[1]! * 10 + copy[2]!);
          }}
        />
      ))}
    </div>
  );
}
