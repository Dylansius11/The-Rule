import { Art } from '@/art/Art';
import { Heron } from '@/mascot/Heron';
import { InkBox } from '@/ui/InkBox';
import { NoTeam } from './NoTeam';

/**
 * What the Stamp tab shows in Team mode before you have a team: why, and the two ways in. Replaces the desk
 * instead of leaving an empty one.
 */
export function TeamSetup() {
  return (
    <div className="wrap grid gap-8">
      <InkBox className="relative p-5 md:p-8" fill="var(--color-paper)" tilt={-0.6}>
        <div className="flex items-center gap-5">
          <Heron pose="suit" width={96} className="hidden shrink-0 sm:block" />
          <div className="min-w-0">
            <span className="hand mb-2 -rotate-1 block text-[24px] leading-none text-tomato-deep">
              one more step
            </span>
            <h2 className="display text-[clamp(36px,6vw,60px)] leading-[0.9]">Your team plays as one</h2>
            <p className="mt-3 max-w-[60ch] text-[17px] font-semibold md:text-[18px]">
              Team mode runs next to Solo every day, with its own rule, pot and ledger. Up to five members
              share one vault, one attempt limit and one line, so every stamp belongs to the whole team. Start
              a team or join one and the stamp desk opens.
            </p>
            <p className="mt-2 flex items-center gap-2 text-[15px] font-bold">
              <Art name="stickers/pointing" width={44} />
              Reading the ledger and replaying a round stay open to everyone.
            </p>
          </div>
        </div>
      </InkBox>
      <NoTeam />
    </div>
  );
}
