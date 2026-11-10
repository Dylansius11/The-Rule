import { Art } from '@/art/Art';
import { useLatestRound } from '@/game';
import { Button } from '@/ui/Button';
import { Doodle } from '@/ui/Doodle';

/** Season in one breath, with the actual latest round record per mode, never a slot-derived count. */
export function SeasonTeaser() {
  const solo = useLatestRound(0);
  const team = useLatestRound(1);
  const latest = (q: typeof solo) =>
    q.isError ? 'unavailable' : q.isLoading ? '…' : q.data ? `#${q.data.roundId}` : 'none';
  return (
    <div className="wrap relative grid items-center gap-8 md:grid-cols-[1.2fr_0.8fr]">
      <div>
        <span className="hand -rotate-1 block text-[26px] leading-none">seven rounds, one board</span>
        <h2 className="display text-[clamp(48px,7vw,92px)] leading-[0.88]">
          A season is a <span className="text-sun">run of rounds</span>
        </h2>
        <p className="mt-4 max-w-[48ch] text-[20px] font-bold leading-snug">
          Solo and Team each keep their own board. Browse observed rounds to see outcomes, plays and replay
          links. Latest round records on this deployment: Solo {latest(solo)}, Team {latest(team)}.
        </p>
        <div className="mt-6">
          <Button to="/season" variant="sun" size="lg">
            See the season
          </Button>
        </div>
      </div>
      <div className="relative mx-auto w-[min(240px,60vw)]">
        <Art name="heron/vest" width={200} />
        <Doodle name="doodles/ribbon" size={72} x={70} y={6} rot={10} float />
      </div>
    </div>
  );
}
