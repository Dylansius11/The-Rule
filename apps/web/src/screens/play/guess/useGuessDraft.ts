import { useEffect, useMemo, useState } from 'react';
import { toUiError } from '@/chain/errors';
import type { useLog } from '@/game';
import type { CanonicalRule } from '@/game/types';
import { checkConsistent, useAtomCatalog, useRuleText } from '@/verify';

export interface Lit {
  atom: number | null;
  neg: boolean;
}

export type Check =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; consistent: boolean; mismatches: number[]; rows: number }
  | { kind: 'error'; message: string };

type Log = ReturnType<typeof useLog>;

/**
 * The guess being written: its shape, its atoms, the canonical rule they make and the free check of that rule
 * against the loaded ledger. Changing the rule clears an old check result.
 */
export function useGuessDraft(log: Log) {
  const catalog = useAtomCatalog();
  const [form, setForm] = useState(0);
  const [lits, setLits] = useState<Lit[]>([
    { atom: null, neg: false },
    { atom: null, neg: false },
  ]);
  const [check, setCheck] = useState<Check>({ kind: 'idle' });

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
  const ruleKey = rule ? JSON.stringify(rule) : '';
  const text = useRuleText(rule);
  useEffect(() => setCheck({ kind: 'idle' }), [ruleKey]);

  const preview = lits
    .slice(0, slots)
    .map(l => catalog.atoms.find(a => a.id === l.atom))
    .map((a, i) => (a ? (lits[i]!.neg ? a.negated : a.english) : null));

  async function runCheck() {
    if (!rule) return;
    setCheck({ kind: 'running' });
    try {
      const r = await checkConsistent(rule, log.rows);
      setCheck({ kind: 'done', consistent: r.consistent, mismatches: r.mismatches, rows: log.rows.length });
    } catch (e) {
      setCheck({ kind: 'error', message: toUiError(e).title });
    }
  }

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
    check,
    runCheck,
  };
}

export type GuessDraft = ReturnType<typeof useGuessDraft>;
