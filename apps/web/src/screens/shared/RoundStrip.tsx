import { Art } from '@/art/Art';
import { formatNear, shortHash } from '@/chain/format';
import type { Mode, Round } from '@/game/types';
import { modeName } from '@/screens/shared/round';
import { RoundStatusTag } from '@/screens/shared/RoundTimer';
import { StatSticker } from '@/ui/Sticker';

interface RoundStripProps {
  mode: Mode;
  round: Round | null;
  loading: boolean;
  /** Share of YES verdicts once the whole log is loaded; shown as a loading dot until then. */
  acceptRate?: string;
}

/** The newest round at a glance. Every sticker is chain data or says it is loading. */
export function RoundStrip({ mode, round, loading, acceptRate }: RoundStripProps) {
  return (
    <dl className="flex flex-wrap gap-x-3.5 gap-y-4" aria-label="Round strip" aria-busy={loading}>
      {round ? (
        <>
          <StatSticker label={`${modeName(mode)} · round ${round.roundId}`} tilt={-2.5}>
            <RoundStatusTag round={round} />
          </StatSticker>
          <StatSticker label="commitment" tilt={0} mono>
            <span title={round.commit ?? undefined}>
              {round.commit ? shortHash(round.commit) : 'not sealed yet'}
            </span>
          </StatSticker>
          <StatSticker label="pot" tone="sun" tilt={2}>
            <span className="inline-flex items-center gap-2">
              <Art name="doodles/jar" width={26} />
              {formatNear(round.pot, 3)} NEAR
            </span>
          </StatSticker>
          <StatSticker label="plays" tone="pink" tilt={1.5}>
            {round.logLen.toLocaleString('en-US')}
          </StatSticker>
          {acceptRate !== undefined ? (
            <StatSticker label="accept rate" tilt={-1}>
              {acceptRate}
            </StatSticker>
          ) : null}
        </>
      ) : (
        <StatSticker label="round" tilt={-2}>
          {loading ? 'Loading…' : 'None yet'}
        </StatSticker>
      )}
    </dl>
  );
}
