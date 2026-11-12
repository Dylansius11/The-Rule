import { formatNear, formatRule } from '@/chain/format';
import { Art } from '@/art/Art';
import { useCountUp } from './useCountUp';

interface AmountProps {
  kind: 'near' | 'rule';
  value: bigint;
  /** Fraction digits for NEAR. RULE shows whole units with up to two decimals. */
  digits?: number;
  /** Count up from zero on first show: for an amount the player has just earned. */
  rise?: boolean;
  className?: string;
}

function trimRule(value: bigint) {
  const [whole, frac = ''] = formatRule(value).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac.slice(0, 2)}` : grouped;
}

/**
 * NEAR or RULE, mono and tabular. RULE carries the token seal. When the recorded value changes while you watch,
 * the number counts to it (never on first load unless `rise`, and not under reduced motion).
 */
export function Amount({ kind, value, digits = 4, rise = false, className = '' }: AmountProps) {
  const shown = useCountUp(value, 700, rise);
  if (kind === 'near') {
    return (
      <span className={`mono whitespace-nowrap font-bold ${className}`}>
        {formatNear(shown, digits)} <span className="text-[0.85em]">NEAR</span>
      </span>
    );
  }
  return (
    <span className={`mono inline-flex items-center gap-1.5 whitespace-nowrap font-bold ${className}`}>
      <Art name="token/seal" width={22} />
      {trimRule(shown)} <span className="text-[0.85em]">RULE</span>
    </span>
  );
}

/** Plain "1.234 NEAR" text in the surrounding type that counts to a changed value, for stickers and tags. */
export function CountedNear({ value, digits = 3 }: { value: bigint; digits?: number }) {
  return <>{formatNear(useCountUp(value), digits)} NEAR</>;
}
