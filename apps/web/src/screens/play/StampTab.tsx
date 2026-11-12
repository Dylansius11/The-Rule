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
        <div className="mt-4 xl:flex xl:items-start xl:justify-between xl:gap-12">
          <p className="max-w-[62ch] text-[16px] font-semibold">
            Every paid play uses one <Term term="attempt" /> and adds a row to the public{' '}
            <Term term="ledger" />. Each unique play also counts as one <Term term="contributor share" /> of
            the final pot.
          </p>
          <div className="mt-6 xl:mt-0 xl:min-w-0 xl:flex-1 xl:[&_dl]:justify-end">
            <RoundStrip
              mode={mode}
              round={round}
              loading={q.isLoading}
              acceptRate={log.complete ? pct(yes, log.rows.length) : '…'}
            />
          </div>
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
          <div
            className="wrap flex min-h-[820px] flex-col items-center text-center md:min-h-[600px]"
            aria-busy="true"
          >
            <Art name="scenes/desk" width={200} eager />
            <p className="display text-[40px]">Asking the chain…</p>
          </div>
        ) : needsTeam ? (
          <TeamSetup />
        ) : (
          <div className="wrap grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(380px,31%)] xl:gap-x-10">
            <div className="min-w-0 xl:col-start-1 xl:row-start-1">
              {round && playing ? (
                <PlayDesk mode={mode} round={round} />
              ) : (
                <NoRoundOpen mode={mode} round={round} />
              )}
            </div>
            <MiniLog mode={mode} round={round} log={log} />
            <CostPayout
              mode={mode}
              round={round}
              className={`w-full xl:col-start-1 xl:row-start-2 ${
                round && playing ? 'max-w-[920px]' : 'mx-auto max-w-[760px]'
              }`}
            />
          </div>
        )}
        {q.isError || q.isLoading || needsTeam ? (
          <div className="wrap mt-8">
            <CostPayout mode={mode} round={round} className="mx-auto max-w-[920px]" />
          </div>
        ) : null}
      </Band>
    </>
  );
}
