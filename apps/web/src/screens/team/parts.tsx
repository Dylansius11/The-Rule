export const busy = (s: { kind: string }) => s.kind === 'signing' || s.kind === 'pending';

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
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
        autoComplete="off"
      />
      {hint ? <p className="mt-1 text-[14px] font-semibold text-ink-soft">{hint}</p> : null}
    </div>
  );
}
