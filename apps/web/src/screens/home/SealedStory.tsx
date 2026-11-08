import {
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useRef, useState } from 'react';
import { Art } from '@/art/Art';
import { useReduced } from '@/motion/prefs';
import { Doodle } from '@/ui/Doodle';
import { Eye, SealedEnvelope } from './StoryArt';
import { LastLaw } from './LastLaw';

const LINES = [
  'One law. Sealed before the first play.',
  'It stamps every play YES or NO.',
  'It opens only at the reveal.',
] as const;

const STARS = [
  { x: 6, y: 12, s: 44, r: -10, n: 'doodles/star-yellow' as const, k: 0.9 },
  { x: 88, y: 8, s: 56, r: 14, n: 'doodles/sparkle' as const, k: 1.4 },
  { x: 22, y: 70, s: 36, r: 0, n: 'doodles/star-pink' as const, k: 0.6 },
  { x: 74, y: 62, s: 40, r: 8, n: 'doodles/star-yellow' as const, k: 1.1 },
  { x: 48, y: 6, s: 30, r: 0, n: 'doodles/star-outline' as const, k: 0.5 },
  { x: 94, y: 78, s: 34, r: -12, n: 'doodles/shooting-star' as const, k: 1.6 },
  { x: 3, y: 46, s: 32, r: 10, n: 'doodles/sparkle' as const, k: 1.2 },
  { x: 60, y: 90, s: 38, r: -6, n: 'doodles/star-yellow' as const, k: 0.8 },
];

function ParallaxStar({ p, st }: { p: MotionValue<number>; st: (typeof STARS)[number] }) {
  const y = useTransform(p, [0.15, 1], [0, -st.k * 520]);
  const o = useTransform(p, [0.15, 0.25], [0, 1]);
  return (
    <motion.span className="story-star" style={{ left: `${st.x}%`, top: `${st.y}%`, y, opacity: o }}>
      <Doodle name={st.n} size={st.s} rot={st.r} twinkle />
    </motion.span>
  );
}

function Line({ p, i, children }: { p: MotionValue<number>; i: number; children: string }) {
  const a = 0.5 + i * 0.07;
  const o = useTransform(p, [a, a + 0.05], [0, 1]);
  const y = useTransform(p, [a, a + 0.05], [28, 0]);
  return (
    <motion.li
      style={{ opacity: o, y }}
      className="display text-[clamp(24px,3.1vw,42px)] leading-[0.95] text-paper"
    >
      <span className="text-sun">{i + 1}.</span> {children}
    </motion.li>
  );
}

function Pinned() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [step, setStep] = useState(1);
  useMotionValueEvent(p, 'change', v =>
    setStep(v < 0.14 ? 1 : v < 0.28 ? 2 : v < 0.45 ? 3 : v < 0.72 ? 4 : v < 0.94 ? 5 : 6),
  );

  // Timeline: eye zoom 0.06-0.3, envelope 0.24-0.46, seal 0.42-0.55, lines 0.5-0.69, Blot 0.72-0.84.
  // Each phase overlaps the previous one so the dark interior never sits empty.
  const eyeScale = useSpring(useTransform(p, [0.06, 0.3], [1, 18]), {
    stiffness: 140,
    damping: 26,
    mass: 0.4,
  });
  const eyeOpacity = useTransform(p, [0.24, 0.3], [1, 0]);
  const titleOpacity = useTransform(p, [0.03, 0.12], [1, 0]);
  const hintOpacity = useTransform(p, [0, 0.08], [1, 0]);
  const envOpacity = useTransform(p, [0.24, 0.32], [0, 1]);
  const envScale = useTransform(p, [0.24, 0.38], [0.3, 1]);
  const envTurn = useTransform(p, [0.24, 0.46], [150, 0]);
  const envY = useTransform(p, [0.24, 0.46, 0.8], [90, 0, -30]);
  const seal = useTransform(p, [0.42, 0.55], [0, 1]);
  const blotX = useTransform(p, [0.72, 0.82], ['130%', '0%']);
  const blotText = useTransform(p, [0.78, 0.84], [0, 1]);

  return (
    <div ref={ref} style={{ height: '420svh' }} aria-label="The sealed law, in six scroll steps" role="group">
      <div className="story-panel bg-ink text-paper">
        <p className="sr-only">Step {step} of 6.</p>
        {STARS.map((st, i) => (
          <ParallaxStar key={i} p={p} st={st} />
        ))}

        <motion.div
          className="absolute inset-x-0 top-[3vh] z-10 text-center"
          style={{ opacity: titleOpacity }}
        >
          <h2 className="display text-[clamp(52px,9vw,120px)] leading-[0.85]">
            What&apos;s <span className="text-sun">inside?</span>
          </h2>
          <motion.p
            className="hand mt-2 text-[28px] text-sun md:text-[34px]"
            style={{ opacity: hintOpacity }}
          >
            keep scrolling. closer. closer.
          </motion.p>
        </motion.div>

        <motion.div
          className="absolute left-1/2 top-1/2 w-[min(900px,92vw)]"
          style={{
            x: '-50%',
            y: '-36%',
            scale: eyeScale,
            opacity: eyeOpacity,
            transformOrigin: '50% 52%',
            willChange: 'transform',
          }}
        >
          <Eye className="block h-auto w-full" />
        </motion.div>

        <div className="absolute inset-0 grid place-items-center" style={{ perspective: 900 }}>
          <motion.div
            className="relative w-[min(420px,60vw,34svh)] -translate-y-[40%] md:-translate-y-[34%]"
            style={{ opacity: envOpacity, scale: envScale, rotateY: envTurn, y: envY }}
          >
            <SealedEnvelope seal={seal} className="block h-auto w-full" />
          </motion.div>
        </div>

        <ul className="absolute inset-x-0 bottom-[3svh] z-10 mx-auto grid max-w-[1000px] gap-2 px-5 max-md:bottom-[2svh] md:bottom-[5svh] md:gap-3 md:pl-10 md:pr-[26%]">
          {LINES.map((l, i) => (
            <Line key={l} p={p} i={i}>
              {l}
            </Line>
          ))}
        </ul>

        <motion.div
          className="absolute bottom-[1svh] right-[2%] z-20 max-md:bottom-[24svh] w-[min(190px,32vw,24svh)] md:right-[5%] md:w-[min(240px,22vw,34svh)]"
          style={{ x: blotX }}
        >
          <div className="paper-halo">
            <Art name="stickers/hiding" width={240} />
          </div>
          <motion.p
            className="hand absolute -top-8 right-1 whitespace-nowrap text-[24px] text-sun md:-top-10 md:text-[30px]"
            style={{ opacity: blotText, rotate: -4 }}
          >
            Not even Blot peeks.
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}

/** Reduced motion: the same story as a readable stack. */
function Static() {
  return (
    <div className="wrap grid gap-10 py-14 text-paper md:grid-cols-2 md:items-center">
      <div>
        <h2 className="display text-[clamp(52px,9vw,110px)] leading-[0.85]">
          What&apos;s <span className="text-sun">inside?</span>
        </h2>
        <ol className="mt-6 grid gap-3">
          {LINES.map((l, i) => (
            <li key={l} className="display text-[clamp(26px,4vw,44px)] leading-[0.95]">
              <span className="text-sun">{i + 1}.</span> {l}
            </li>
          ))}
        </ol>
        <p className="hand mt-5 text-[30px] text-sun">Not even Blot peeks.</p>
      </div>
      <div className="relative mx-auto grid w-full max-w-[420px] gap-6">
        <Eye className="block h-auto w-full" />
        <SealedEnvelope className="mx-auto block h-auto w-[70%]" />
        <div className="paper-halo mx-auto w-[180px]">
          <Art name="stickers/hiding" width={180} />
        </div>
      </div>
    </div>
  );
}

/** The sealed-law scroll story: pinned about 400 vh, six steps, lands on "The last law, opened". */
export function SealedStory() {
  const reduced = useReduced();
  return (
    <div id="sealed-law" className="bg-ink">
      {reduced ? <Static /> : <Pinned />}
      <LastLaw />
    </div>
  );
}
