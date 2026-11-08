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
