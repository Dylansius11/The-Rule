import { useState } from 'react';
import { Blot, type BlotState } from '@/mascot/Blot';
import type { PlayState, UiError } from '@/game/types';
import { Button } from '@/ui/Button';
import { ErrorCard } from '@/ui/ErrorCard';
import { PlaySlip } from '@/ui/Slip';
import { VerdictTag } from '@/ui/Tag';
import { ProgressMeter } from '@/ui/ProgressMeter';
import { Heron } from '@/mascot/Heron';
import { Drip } from '@/mascot/Drip';
import { Band } from '@/ui/Band';
import { PlayDesk } from './home/PlayDesk';
import type { Round } from '@/game/types';

const input = { number: 7, word: 'otter' };
const row = {
  logIdx: 1,
  seq: 1,
  playKey: 'sample',
  entityTag: 0,
  entityId: 0,
  actor: 0,
  account: 'sample.testnet',
  number: 7,
  wordId: 1,
  word: 'otter',
  minuteDigit: 3,
  prev: null,
  verdict: true,
  minted: 100_000_000_000_000_000_000n,
};
const SAMPLE_ERROR: UiError = {
  code: 'E14',
  title: 'Sample failure',
  funds: 'Nothing was charged (sample text).',
  next: 'Pick another play (sample text).',
  retryable: true,
};
const STATES: PlayState[] = [
  { kind: 'idle' },
  { kind: 'prechecking', input },
  { kind: 'signing', input },
  { kind: 'pending', input, txHash: null, sinceMs: 0 },
  { kind: 'known', input, row },
  { kind: 'accepted', input, row, txHash: null },
  { kind: 'rejected', input, row: { ...row, verdict: false }, txHash: null },
  { kind: 'refunded', input, txHash: null },
  { kind: 'error', input, error: SAMPLE_ERROR },
];
const SAMPLE_ROUND: Round = {
  mode: 0,
  roundId: 0,
  phase: 'Investigation',
  demo: false,
  commit: null,
  header: null,
  seed: null,
  pot: 0n,
  allowanceLeft: 0n,
  logLen: 0,
  pendingChecks: 0,
  sealedAtMs: null,
  investigationEndMs: null,
  freezeMs: null,
  revealDeadlineMs: null,
  outcome: null,
  rule: null,
  salt: null,
};
const BLOTS: BlotState[] = ['hero', 'idle', 'pending', 'yes', 'no', 'already', 'reveal'];

/** DEV only. Every component state with clearly labeled SAMPLE props. Never shipped as live data. */
export function DevStates() {
  const [burst, setBurst] = useState(0);
  return (
    <div className="wrap py-10">
      <p className="mono mb-4 rounded bg-ink px-3 py-2 text-sun">SAMPLE PROPS · dev route · not chain data</p>
      <h1 className="display text-[56px]">Component states</h1>
      <h2 className="display mt-8 text-[36px]">Play slip, every PlayState</h2>
      <div className="grid gap-5 md:grid-cols-3">
        {STATES.map(s => (
          <div key={s.kind}>
            <div className="mono text-[13px] font-bold">{s.kind}</div>
            <PlaySlip state={s} />
          </div>
        ))}
      </div>
      <h2 className="display mt-8 text-[36px]">Stamp desk with a SAMPLE open round (no chain data)</h2>
      <Band tone="sun" edge={false} className="mt-4 py-14">
        <PlayDesk mode={0} round={SAMPLE_ROUND} />
      </Band>
      <h2 className="display mt-8 text-[36px]">Blot</h2>
      <div className="flex flex-wrap items-end gap-4">
        {BLOTS.map(b => (
          <div key={b} className="w-[140px] text-center">
            <Blot state={b} width="100%" burst={b === 'yes' ? burst : null} alt={b} />
            <div className="mono text-[13px]">{b}</div>
          </div>
        ))}
        <Button size="sm" onClick={() => setBurst(n => n + 1)}>
          Burst
        </Button>
      </div>
      <h2 className="display mt-8 text-[36px]">Misc</h2>
      <div className="flex flex-wrap items-center gap-4">
        <VerdictTag verdict />
        <VerdictTag verdict={false} />
        <Heron pose="vest" width={80} />
        <Drip pose="peek" width={100} />
      </div>
      <div className="mt-4 max-w-[500px]">
        <ProgressMeter label="Sample meter" value={52} max={120} unit="plays loaded" />
      </div>
      <div className="mt-4 max-w-[600px]">
        <ErrorCard error={SAMPLE_ERROR} onRetry={() => undefined} />
      </div>
    </div>
  );
}
