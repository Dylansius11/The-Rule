import { AtomPicker } from '@/screens/shared/AtomPicker';
import { RadioChips } from '@/ui/Chip';
import type { GuessDraft } from './useGuessDraft';

const SHAPES: Record<number, string> = {
  0: 'One atom decides everything.',
  1: 'Both atoms must be true.',
  2: 'Either atom being true is enough.',
};

/** Step 1: pick a shape and one or two published atoms; read the guess back in plain words. */
export function HypothesisStep({ draft }: { draft: GuessDraft }) {
  const { catalog, form, slots, first, second, rule, text, preview, duplicate } = draft;
  const shapes = catalog.forms.length
    ? catalog.forms
    : [
        { id: 0, name: 'Single' },
        { id: 1, name: 'AND' },
        { id: 2, name: 'OR' },
      ];
  return (
    <div>
      <p className="text-[17px] font-semibold">
        The hidden law is a short sentence made of one or two published building blocks, called atoms, such as
        “the number is even”. Pick how many atoms your guess uses, then choose them. You can flip any atom to
        its opposite.
      </p>
      <div className="mt-4">
        <RadioChips
          label="Rule shape"
          value={form}
          onChange={draft.setForm}
          options={shapes.map(f => ({ value: f.id, label: f.name }))}
          small
        />
        <p className="mt-2 text-[15px] font-bold">{SHAPES[form] ?? ''}</p>
      </div>
      {catalog.atoms.length === 0 ? (
        <p className="mt-4 font-bold" aria-busy="true">
          Loading the published atoms…
        </p>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:items-start">
          <AtomPicker
            label={slots === 1 ? 'Atom' : 'First atom'}
            atoms={catalog.atoms}
            atomId={first.atom}
            negated={first.neg}
            taken={slots === 2 ? second.atom : null}
            onChange={draft.setFirst}
          />
          {slots === 2 ? (
            <AtomPicker
              label="Second atom"
              atoms={catalog.atoms}
              atomId={second.atom}
              negated={second.neg}
              taken={first.atom}
              onChange={draft.setSecond}
            />
          ) : null}
        </div>
      )}

      <div className="mt-6 rounded-lg border-[3px] border-ink bg-paper-2 p-4" aria-live="polite">
        <div className="mono text-[12px] font-bold uppercase tracking-widest text-ink-soft">
          Your guess reads
        </div>
        {rule ? (
          <p className="mt-1 text-[22px] font-extrabold leading-snug">
            {text ? text.english : preview.filter(Boolean).join(form === 1 ? ' and ' : ' or ')}
          </p>
        ) : (
          <p className="mt-1 font-bold">
            {duplicate ? 'The two atoms must differ.' : 'Pick the atoms to see the rule in words.'}
          </p>
        )}
        {text ? <code className="mono mt-2 block break-all text-[13px] font-bold">{text.dsl}</code> : null}
      </div>
    </div>
  );
}
