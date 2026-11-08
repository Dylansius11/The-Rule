import { useRef, type KeyboardEvent, type ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  /** Toggle chip (filters). Uses aria-pressed. */
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  plain?: boolean;
  small?: boolean;
  title?: string;
  className?: string;
}

/** A sticker chip. As a toggle it reports aria-pressed; selection is also drawn (tomato fill, tilt and a dot), never colour alone. */
export function Chip({
  children,
  pressed,
  onClick,
  disabled,
  plain,
  small,
  title,
  className = '',
}: ChipProps) {
  return (
    <button
      type="button"
      className={`chip ${small ? 'chip-sm' : ''} ${className}`}
      aria-pressed={pressed}
      data-plain={plain ? 'true' : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface ChipOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Plain-text name for assistive tech when label is not text. */
  ariaLabel?: string;
}

interface RadioChipsProps<T extends string | number> {
  label: string;
  value: T | null;
  options: readonly ChipOption<T>[];
  onChange: (value: T) => void;
  plain?: boolean;
  small?: boolean;
  disabled?: boolean;
  className?: string;
}

/** A radio group of chips with roving tabindex and arrow-key movement. */
export function RadioChips<T extends string | number>({
  label,
  value,
  options,
  onChange,
  plain,
  small,
  disabled,
  className = '',
}: RadioChipsProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter(o => !o.disabled);
  const activeValue = value ?? enabled[0]?.value ?? null;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key) || enabled.length === 0) return;
    e.preventDefault();
    const idx = Math.max(
      0,
      enabled.findIndex(o => o.value === activeValue),
    );
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % enabled.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + enabled.length) % enabled.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = enabled.length - 1;
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
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
      className={`flex flex-wrap gap-x-2.5 gap-y-3 ${className}`}
    >
      {options.map(o => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            data-value={String(o.value)}
            tabIndex={o.value === activeValue ? 0 : -1}
            disabled={disabled || o.disabled}
            data-plain={plain ? 'true' : undefined}
            className={`chip ${small ? 'chip-sm' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
