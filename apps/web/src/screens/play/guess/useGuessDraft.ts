import { useMemo, useState } from 'react';
import type { CanonicalRule } from '@/game/types';
import { useAtomCatalog, useRuleText } from '@/verify';

export interface Lit {
  atom: number | null;
  neg: boolean;
}

/** The guess being written: its shape, its atoms and the canonical rule they make. */
export function useGuessDraft() {
  const catalog = useAtomCatalog();
  const [form, setForm] = useState(0);
  const [lits, setLits] = useState<Lit[]>([
    { atom: null, neg: false },
    { atom: null, neg: false },
  ]);

  const slots = form === 0 ? 1 : 2;
  const first = lits[0]!;
  const second = lits[1]!;
  const duplicate = slots === 2 && first.atom !== null && first.atom === second.atom;

  const rule: CanonicalRule | null = useMemo(() => {
    const picked = lits.slice(0, slots);
    if (picked.some(l => l.atom === null) || (slots === 2 && picked[0]!.atom === picked[1]!.atom))
      return null;
    const pairs = picked
      .map(l => [l.atom!, l.neg ? 1 : 0] as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { v: 'g1', form, lits: pairs };
  }, [lits, slots, form]);
  const text = useRuleText(rule);

  const preview = lits
    .slice(0, slots)
    .map(l => catalog.atoms.find(a => a.id === l.atom))
    .map((a, i) => (a ? (lits[i]!.neg ? a.negated : a.english) : null));

  return {
    catalog,
    form,
    setForm,
    slots,
    first,
    second,
    setFirst: (atom: number | null, neg: boolean) => setLits([{ atom, neg }, second]),
    setSecond: (atom: number | null, neg: boolean) => setLits([first, { atom, neg }]),
    duplicate,
    rule,
    text,
    preview,
  };
}

export type GuessDraft = ReturnType<typeof useGuessDraft>;
