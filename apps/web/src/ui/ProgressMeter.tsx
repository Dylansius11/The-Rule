import { Drip } from '@/mascot/Drip';

interface ProgressMeterProps {
  label: string;
  value: number;
  max: number;
  /** Text after the numbers, e.g. "plays loaded". */
  unit?: string;
  tone?: 'pink' | 'lime';
  /** Drip crawls along the bar at the progress edge. */
  crawl?: boolean;
}

/** A completeness meter. Numbers are written out; Drip crawls at the leading edge while incomplete. */
export function ProgressMeter({
  label,
  value,
  max,
  unit = '',
  tone = 'pink',
  crawl = true,
}: ProgressMeterProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const done = max > 0 && value >= max;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="font-extrabold">{label}</span>
        <span className="mono text-[14px] font-bold">
          {value.toLocaleString('en-US')} of {max.toLocaleString('en-US')} {unit}
        </span>
      </div>
      <div className="relative pt-9">
        {crawl && !done ? (
          <span
            className="pointer-events-none absolute top-0 -translate-x-1/2 transition-[left] duration-500"
            style={{ left: `clamp(32px, ${pct}%, calc(100% - 32px))` }}
          >
            <Drip pose="crawl" width={64} />
          </span>
        ) : null}
        <div
          className="meter"
          data-tone={tone}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.min(value, max)}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
