import { useMemo, useState } from 'react';
import type { AtomCatalog } from '@/verify';
import { Chip } from '@/ui/Chip';

type Atom = AtomCatalog['atoms'][number];

interface AtomPickerProps {
  label: string;
  atoms: readonly Atom[];
  atomId: number | null;
  negated: boolean;
  onChange: (atomId: number | null, negated: boolean) => void;
  /** Atom ids already used by the other literal (a rule may not repeat an atom). */
  taken?: number | null;
}

/** Pick one published atom from the catalog (search by words), then optionally flip it to its opposite. */
export function AtomPicker({ label, atoms, atomId, negated, onChange, taken }: AtomPickerProps) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? atoms.filter(a => a.english.toLowerCase().includes(needle) || a.dsl.toLowerCase().includes(needle))
      : atoms;
  }, [atoms, q]);
  const chosen = atoms.find(a => a.id === atomId) ?? null;
  const inputId = `atom-search-${label.replace(/\W+/g, '-')}`;

  return (
    <fieldset className="min-w-0">
      <legend className="hand mb-1 text-[26px]">{label}</legend>
      <label htmlFor={inputId} className="sr-only">
        Search the published atoms for {label}
      </label>
      <input
        id={inputId}
        className="field"
        type="search"
        placeholder="Search, e.g. even, digit 7, below 500"
        value={q}
        onChange={e => setQ(e.target.value)}
        autoComplete="off"
      />
      <div
        className="mt-2 max-h-[260px] overflow-auto rounded-lg border-[3px] border-ink bg-white"
        role="radiogroup"
        aria-label={`${label} atoms`}
      >
        {shown.length === 0 ? <p className="p-3 font-bold">No atom matches that search.</p> : null}
        {shown.map(a => {
          const on = a.id === atomId;
          const blocked = a.id === taken;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={blocked}
              onClick={() => onChange(a.id, negated)}
              className={`flex min-h-[44px] w-full items-center gap-2.5 border-b-2 border-dashed border-ink/30 px-3 py-1.5 text-left text-[16px] font-bold ${on ? 'bg-sun' : 'hover:bg-sun/40'} disabled:opacity-40`}
            >
              <span
                aria-hidden="true"
                className={`grid h-5 w-5 flex-none place-items-center rounded-full border-2 border-ink ${on ? 'bg-ink text-sun' : 'bg-white'}`}
              >
                {on ? '✓' : ''}
              </span>
              <span data-atom-text className="min-w-0 flex-1 break-words">
                <span className="block">{a.english}</span>
                <code className="mono mt-0.5 hidden break-all text-[12px] font-semibold leading-snug text-ink-soft sm:block">
                  {a.dsl}
                </code>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Chip pressed={negated} small disabled={chosen === null} onClick={() => onChange(atomId, !negated)}>
          Use the opposite
        </Chip>
        <p className="min-w-0 flex-1 text-[15px] font-bold">
          {chosen ? (
            <>
              Means: <span className="hl">{negated ? chosen.negated : chosen.english}</span>
            </>
          ) : (
            'Nothing picked yet.'
          )}
        </p>
      </div>
    </fieldset>
  );
}
