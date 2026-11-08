import { Link } from 'react-router';
import { shortHash, formatNear, timeAgo } from '@/chain/format';
import type { useLog } from '@/game';
import type { Mode, Round } from '@/game/types';
import { Art } from '@/art/Art';
import { Blot } from '@/mascot/Blot';
import { Button } from '@/ui/Button';
import { Doodle } from '@/ui/Doodle';
import { Letters } from '@/ui/Letters';
import { StatSticker } from '@/ui/Sticker';
import { Tag } from '@/ui/Tag';
import { ModePicker } from '../shared/ModePicker';
import { phaseLabel, modeName, isActive } from '../shared/round';
import { pct } from '../shared/format';

type Log = ReturnType<typeof useLog>;

interface HeroProps {
  mode: Mode;
  onMode: (m: Mode) => void;
  round: Round | null;
  loading: boolean;
  log: Log;
}

/** "FIND THE RULE!" with the live round strip. Every sticker is chain data or says it is loading. */
export function Hero({ mode, onMode, round, loading, log }: HeroProps) {
  const yes = log.rows.filter(r => r.verdict).length;
  const active = isActive(round);
  const kicker = round
    ? `${modeName(mode).toLowerCase()} · round ${round.roundId} · ${active ? (round.sealedAtMs ? `sealed ${timeAgo(round.sealedAtMs)}` : phaseLabel(round.phase).toLowerCase()) : `last round: ${phaseLabel(round.phase).toLowerCase()}`} ↓`
    : loading
      ? 'asking the chain…'
      : 'no round has started yet ↓';

  return (
    <section className="relative overflow-hidden pb-24 pt-8 md:pb-28 md:pt-12" aria-labelledby="hero-title">
      <Doodle name="doodles/star-yellow" x={38} y={9} size={56} rot={-12} twinkle />
      <Doodle
        name="doodles/star-outline"
        x={46}
        y={52}
        size={40}
        rot={10}
        twinkle
        delay={0.7}
        className="hidden md:inline-block"
      />
      <Doodle name="doodles/sparkle" x={58} y={4} size={38} rot={20} twinkle delay={1.2} />
      <Doodle
        name="doodles/star-pink"
        x={3}
        y={80}
        size={44}
        rot={14}
        twinkle
        delay={0.3}
        className="hidden md:inline-block"
      />
      <div className="wrap grid items-center gap-6 md:grid-cols-[1.25fr_0.75fr] md:gap-8">
        <div>
          <span className="hand mb-1 block -rotate-2 text-[24px] md:text-[28px]">{kicker}</span>
          <h1
            id="hero-title"
            className="display poster text-[clamp(96px,27vw,236px)] leading-[0.78] md:text-[clamp(110px,11.5vw,200px)]"
            aria-label="Find the rule!"
          >
            <span className="block text-sun" aria-hidden="true">
              <Letters text="Find" />
            </span>
            <span className="ml-[0.6em] block text-paper" aria-hidden="true">
              <Letters text="the" />
            </span>
            <span className="block text-tomato" aria-hidden="true">
              <Letters text="rule!" />
            </span>
          </h1>
          <p className="mb-6 mt-7 max-w-[30ch] text-[22px] font-bold leading-tight md:text-[26px]">
            A law is sealed. Throw a number and a word at it. It stamps YES or NO. Spot the pattern, win the
            pot.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative">
              <Button to="/#play" variant="red" size="xl">
                Start stamping
              </Button>
              <Doodle
                name="doodles/hand"
                size={40}
                right={-6}
                bottom={-34}
                rot={-14}
                float
                className="md:hidden"
              />
            </div>
            <div className="flex items-center gap-3">
              <ModePicker mode={mode} onChange={onMode} label="Round mode" />
              <Doodle name="doodles/arrow-double" size={64} className="hidden lg:inline-block" />
            </div>
            <Art name="scenes/arcade" width={120} className="hidden xl:block" />
          </div>

          <dl className="mt-9 flex flex-wrap gap-3.5" aria-label="Round strip" aria-busy={loading}>
            {round ? (
              <>
                <StatSticker label={`${modeName(mode)} · round ${round.roundId}`} tilt={-2.5}>
                  <Tag tone={active ? 'sun' : 'soft'}>{phaseLabel(round.phase)}</Tag>
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
                <StatSticker label="accept rate" tilt={-1}>
                  {log.complete ? pct(yes, log.rows.length) : '…'}
                </StatSticker>
              </>
            ) : (
              <StatSticker label="round" tilt={-2}>
                {loading ? 'Loading…' : 'None yet'}
              </StatSticker>
            )}
          </dl>
          {round ? (
            <p className="mt-4 text-[15px] font-semibold text-ink-soft">
              Numbers come straight from the chain.{' '}
              <Link
                to={`/log?mode=${mode}&round=${round.roundId}`}
                className="font-extrabold underline decoration-2 underline-offset-2"
              >
                Read every play
              </Link>
              .
            </p>
          ) : null}
        </div>

        <div className="relative mx-auto w-full max-w-[470px] justify-self-center md:ml-auto">
          <div className="mx-auto flex w-[min(300px,72vw)] justify-center md:w-full">
            <Blot state="hero" width="100%" lean />
          </div>
          <div
            className="absolute -bottom-6 left-0 -rotate-6 md:bottom-12 md:-left-28"
            style={{ width: 170 }}
          >
            <Art name="doodles/bubble" width={170} />
            <p className="hand absolute inset-0 grid place-items-center pb-3 text-center text-[19px] leading-[1.05] md:text-[21px]">
              <span>
                that&apos;s Blot.
                <br />
                he&apos;s sealed.
                <br />
                don&apos;t ask.
              </span>
            </p>
          </div>
          <Doodle
            name="doodles/arrow-curve"
            size={90}
            x={-8}
            y={78}
            rot={20}
            className="hidden md:inline-block"
          />
        </div>
      </div>
    </section>
  );
}
