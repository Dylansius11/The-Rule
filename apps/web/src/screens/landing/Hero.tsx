import type { CSSProperties } from 'react';
import { Art } from '@/art/Art';
import { HeroBlot } from '@/mascot/HeroBlot';
import { Button } from '@/ui/Button';
import { Doodle, StarField } from '@/ui/Doodle';
import { InkBox } from '@/ui/InkBox';
import { Letters } from '@/ui/Letters';

const DISC: CSSProperties = { '--r': '49% 51% 50% 50% / 52% 48% 52% 48%' } as CSSProperties;

/** The landing hero: poster title and the way in on the left, Blot on a sun disc on the right, doodles out in the gutters. */
export function Hero() {
  return (
    <section
      id="landing-hero"
      className="relative overflow-hidden pb-32 pt-8 md:pb-40 md:pt-12"
      aria-labelledby="hero-title"
    >
      <StarField
        className="max-[1439px]:hidden"
        spots={[
          { x: 1.5, y: 10, s: 54, r: -12, n: 'doodles/star-yellow' },
          { x: 2.5, y: 46, s: 44, r: 10, n: 'doodles/star-outline' },
          { x: 1.2, y: 78, s: 50, r: 14, n: 'doodles/star-pink' },
          { x: 96.5, y: 8, s: 46, r: 20, n: 'doodles/sparkle' },
          { x: 96, y: 44, s: 56, r: -8, n: 'doodles/star-yellow' },
          { x: 97, y: 76, s: 44, r: 12, n: 'doodles/shooting-star' },
        ]}
      />
      <div className="wrap grid items-center gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-8">
        <div className="relative">
          <span className="hand mb-1 block -rotate-2 text-[24px] md:text-[30px]">
            a game with one secret law
          </span>
          <h1
            id="hero-title"
            className="display poster text-[clamp(96px,27vw,200px)] leading-[0.78] md:text-[clamp(96px,13.5vw,176px)] lg:text-[clamp(110px,9.8vw,176px)]"
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
          <p className="mb-6 mt-6 max-w-[30ch] text-[22px] font-bold leading-tight md:text-[26px]">
            A law is sealed. Throw a number and a word at it. It stamps YES or NO. Spot the pattern, win the
            pot.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-5">
            <div className="relative">
              <Button to="/play" variant="red" size="xl">
                Enter the game
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
            <Button to="/#how" variant="paper" size="md">
              How to play
            </Button>
          </div>
          <p className="mt-6 max-w-[44ch] text-[16px] font-bold text-ink-soft">
            Reading is open to everyone. A testnet wallet is only asked for when you stamp, commit or claim.
          </p>
        </div>

        <div className="relative order-first mx-auto w-[min(260px,66vw)] md:order-none md:w-full md:max-w-[480px] md:justify-self-end lg:w-[min(100%,600px,calc(100svh-240px))] lg:max-w-[600px]">
          <div className="absolute inset-x-[4%] bottom-[2%] top-[10%]" aria-hidden="true">
            <InkBox fill="var(--color-sun)" style={DISC} className="h-full w-full" />
          </div>
          <div className="relative px-[8%] pt-[4%]">
            <HeroBlot />
          </div>
          <div
            className="absolute -bottom-3 -left-10 z-[2] w-[128px] -rotate-6 md:bottom-[8%] md:left-[-6%] md:w-[190px]"
            style={{ containerType: 'inline-size' }}
          >
            <Art name="doodles/bubble" width={190} />
            <p
              className="hand absolute left-[9%] right-[7%] top-[13%] grid h-[60%] place-items-center text-center leading-[1.05]"
              style={{ fontSize: '9.8cqw' }}
            >
              <span>
                that&apos;s Blot.
                <br />
                he&apos;s sealed.
                <br />
                don&apos;t ask.
              </span>
            </p>
          </div>
          <Doodle name="doodles/star-yellow" size={54} x={4} y={4} rot={-12} twinkle />
          <Doodle name="doodles/sparkle" size={44} x={88} y={2} rot={18} twinkle delay={0.8} />
          <Doodle name="doodles/arrow-curve" size={84} x={-2} y={52} rot={20} className="max-xl:hidden" />
          <Doodle
            name="doodles/star-pink"
            size={44}
            x={90}
            y={74}
            rot={14}
            twinkle
            delay={0.4}
            className="max-sm:hidden"
          />
        </div>
      </div>
    </section>
  );
}
