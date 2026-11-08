import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSound } from '@/audio';

interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Plain-text name for assistive tech when the label is not text. */
  ariaLabel?: string;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  /** `sm` is the thin strip toggle; `md` is the bold mode switch. */
  size?: 'sm' | 'md';
  className?: string;
}

/** Two or three joined options, one chosen. A radio group with arrow keys; the chosen one is filled and underlined, never colour alone. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className = '',
}: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const { play } = useSound();

  function pick(next: T) {
    if (next !== value) play('toggle');
    onChange(next);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!forward && !back) return;
    e.preventDefault();
    const idx = Math.max(
      0,
      options.findIndex(o => o.value === value),
    );
    const target = options[(idx + (forward ? 1 : -1) + options.length) % options.length];
    if (!target) return;
    pick(target.value);
    requestAnimationFrame(() =>
      group.current?.querySelector<HTMLButtonElement>(`[data-value="${String(target.value)}"]`)?.focus(),
    );
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className={`seg ${className}`}
      data-size={size}
    >
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          data-value={String(o.value)}
          tabIndex={o.value === value ? 0 : -1}
          className="seg-opt"
          onClick={() => pick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
