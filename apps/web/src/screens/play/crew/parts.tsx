import { useId, useState } from 'react';
import { Button } from '@/ui/Button';

export const busy = (s: { kind: string }) => s.kind === 'signing' || s.kind === 'pending';

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-extrabold">
        {label}
      </label>
      <input
        id={id}
        className="field"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-hint` : undefined}
        autoComplete="off"
      />
      {error || hint ? (
        <p
          id={`${id}-hint`}
          role={error ? 'alert' : undefined}
          className="mt-1 text-[14px] font-semibold text-ink-soft"
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

/** A read-only value with a Copy button. Says plainly when the browser blocks the clipboard. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'copied' | 'blocked'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('blocked');
    }
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-extrabold">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          className="field field-mono min-w-0 flex-1"
          readOnly
          value={value}
          onFocus={e => e.currentTarget.select()}
        />
        <Button variant="paper" size="sm" onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p role="status" className="mt-1 min-h-[1.25rem] text-[14px] font-bold">
        {state === 'copied'
          ? 'Copied to your clipboard.'
          : state === 'blocked'
            ? 'Copying was blocked. Select the text above and copy it yourself.'
            : ''}
      </p>
    </div>
  );
}
