import { useId } from 'react';
import { parseNear } from '@/chain/format';

/** Parse a NEAR text field. Returns the amount or an inline message; empty text is neither. */
export function readNear(text: string): { amount: bigint | null; error: string | null } {
  if (text.trim() === '') return { amount: null, error: null };
  try {
    const amount = parseNear(text);
    return amount > 0n ? { amount, error: null } : { amount: null, error: 'Enter an amount above zero.' };
  } catch (e) {
    return { amount: null, error: e instanceof Error ? e.message : 'Enter a NEAR amount.' };
  }
}

interface AmountFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  unit?: string;
  hint?: string;
  disabled?: boolean;
}

export function AmountField({
  label,
  value,
  onChange,
  error,
  unit = 'NEAR',
  hint,
  disabled,
}: AmountFieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-extrabold">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          className="field field-mono"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
          onChange={e => onChange(e.target.value)}
        />
        <span className="mono font-bold">{unit}</span>
      </div>
      {error ? (
        <p id={`${id}-e`} className="mt-1 text-[14px] font-extrabold text-tomato-deep">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-h`} className="mt-1 text-[14px] font-semibold text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
