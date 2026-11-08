import { formatNear, formatRule } from '@/chain/format';
import { Art } from '@/art/Art';

interface AmountProps {
  kind: 'near' | 'rule';
  value: bigint;
  /** Fraction digits for NEAR. RULE shows whole units with up to two decimals. */
  digits?: number;
  className?: string;
}

function trimRule(value: bigint) {
  const [whole, frac = ''] = formatRule(value).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac.slice(0, 2)}` : grouped;
}

/** NEAR or RULE, mono and tabular. RULE carries the token seal. */
export function Amount({ kind, value, digits = 4, className = '' }: AmountProps) {
  if (kind === 'near') {
    return (
      <span className={`mono whitespace-nowrap font-bold ${className}`}>
        {formatNear(value, digits)} <span className="text-[0.85em]">NEAR</span>
      </span>
    );
  }
  return (
    <span className={`mono inline-flex items-center gap-1.5 whitespace-nowrap font-bold ${className}`}>
      <Art name="token/seal" width={22} />
      {trimRule(value)} <span className="text-[0.85em]">RULE</span>
    </span>
  );
}
