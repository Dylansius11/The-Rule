import { toUiError } from '@/chain/errors';
import { useLog, usePlayer, useWallet } from '@/game';
import { Art } from '@/art/Art';
import { PageHead } from '@/screens/shared/PageHead';
import { pct } from '@/screens/shared/format';
import { isActive } from '@/screens/shared/round';
import { usePlaysOpen } from '@/screens/shared/useRoundClock';
import { Band } from '@/ui/Band';
import { StarField } from '@/ui/Doodle';
import { ErrorCard } from '@/ui/ErrorCard';
import { Term } from '@/ui/Term';
import { CostPayout } from './CostPayout';
import { MiniLog } from './MiniLog';
import { NoRoundOpen } from './NoRoundOpen';
import { PlayDesk } from './PlayDesk';
import { RoundStrip } from '@/screens/shared/RoundStrip';
import { SetupChecklist } from '@/screens/shared/SetupChecklist';
import { TeamSetup } from './crew/TeamSetup';
import { useRoom } from './room';

/** The first tab of the room: the stamp desk and the newest plays. Team mode without a team shows the team setup instead. */
export function StampTab() {
  const { mode, latest: q } = useRoom();
  const round = q.data ?? null;
  const { status, accountId } = useWallet();
  const player = usePlayer(accountId);
  const log = useLog(mode, round?.roundId ?? null, { follow: isActive(round) });
  const playing = usePlaysOpen(round);
  const needsTeam =
    mode === 1 && status === 'connected' && player.isSuccess && (player.data?.teamId ?? null) === null;
  const yes = log.rows.filter(r => r.verdict).length;

  return (
    <>
      <div className="wrap pb-14 pt-7 md:pb-16 md:pt-10">
        <PageHead
          kicker={mode === 0 ? 'your line, your credit' : 'your crew, one vault'}
          title={
            <>
              Stamp <span className="text-tomato">a play</span>
            </>
          }
          note={
            mode === 0
              ? 'Throw a number and a word at the sealed law. It answers YES or NO.'
              : 'Team plays are paid from the team vault, and the whole team shares one line.'
          }
          art="stickers/stamping"
          artWidth={120}
        />
        <p className="mt-4 max-w-[62ch] text-[16px] font-semibold">
          Every paid play uses one <Term term="attempt" /> and adds a row to the public <Term term="ledger" />
          . Each unique play also counts as one <Term term="contributor share" /> of the final pot.
        </p>
        <div className="mt-6">
          <RoundStrip
            mode={mode}
            round={round}
            loading={q.isLoading}
            acceptRate={log.complete ? pct(yes, log.rows.length) : '…'}
          />
        </div>
      </div>

      <Band
        tone="sun"
        id="desk"
        label="Stamp desk"
        seed={2}
        amp={12}
        className="pb-24 pt-24 md:pb-28 md:pt-28"
      >
        <StarField
          spots={[
            { x: 2, y: 18, s: 50, r: -10, n: 'doodles/star-outline' },
            { x: 96, y: 12, s: 60, r: 14, n: 'doodles/star-outline' },
            { x: 48, y: 5, s: 34, r: 0, n: 'doodles/sparkle' },
            { x: 97, y: 66, s: 40, r: -14, n: 'doodles/star-outline' },
          ]}
        />
        <div className="wrap mb-8 empty:hidden">
          <SetupChecklist />
        </div>
        {q.isError ? (
          <div className="wrap">
            <ErrorCard error={toUiError(q.error)} onRetry={() => void q.refetch()} />
          </div>
        ) : q.isLoading ? (
          <div className="wrap flex flex-col items-center text-center" aria-busy="true">
            <Art name="scenes/desk" width={200} eager />
            <p className="display text-[40px]">Asking the chain…</p>
          </div>
        ) : needsTeam ? (
          <TeamSetup />
        ) : round && playing ? (
          <PlayDesk mode={mode} round={round} />
        ) : (
          <div className="wrap">
            <NoRoundOpen mode={mode} round={round} />
          </div>
        )}
        <div className="wrap mt-8">
          <CostPayout mode={mode} round={round} className="mx-auto max-w-[920px]" />
        </div>
      </Band>

      <Band tone="paper" id="ledger" label="Newest plays" seed={3} amp={10} className="pb-24 pt-24 md:pb-28">
        <MiniLog mode={mode} round={round} log={log} />
      </Band>
    </>
  );
}
