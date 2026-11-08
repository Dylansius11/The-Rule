import { Art } from '@/art/Art';
import { useNextSlot } from '@/game';
import { Button } from '@/ui/Button';
import { Doodle } from '@/ui/Doodle';

/** Season in one breath, with the real count of rounds each mode has run on this deployment. */
export function SeasonTeaser() {
  const solo = useNextSlot(0);
  const team = useNextSlot(1);
  const count = (q: typeof solo) => (q.data ? String(q.data.roundId) : q.isLoading ? '…' : '–');
  return (
    <div className="wrap relative grid items-center gap-8 md:grid-cols-[1.2fr_0.8fr]">
      <div>
        <span className="hand -rotate-1 block text-[26px] leading-none">seven rounds, one board</span>
        <h2 className="display text-[clamp(48px,7vw,92px)] leading-[0.88]">
          A season is a <span className="text-sun">run of rounds</span>
        </h2>
        <p className="mt-4 max-w-[48ch] text-[20px] font-bold leading-snug">
          Solo and Team each keep their own board and a history of every round: who won, how many plays, and a
          way to replay it. Rounds played on this deployment so far: Solo {count(solo)}, Team {count(team)}.
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
