import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Art } from '@/art/Art';
import { art } from '@/art/manifest';
import { useReduced } from '@/motion/prefs';
import { usePointerNorm, usePreload } from '@/motion/hooks';
import { StarBurst } from './StarBurst';

export type BlotState = 'hero' | 'idle' | 'pending' | 'yes' | 'no' | 'already' | 'reveal';

const SRC: Record<BlotState, string> = {
  hero: art['blot/hero'].src,
  idle: art['blot/idle'].src,
  pending: art['blot/pending'].src,
  yes: art['blot/yes'].src,
  no: art['blot/no'].src,
  already: art['blot/already'].src,
  reveal: art['blot/reveal'].src,
};
const ALL = Object.values(SRC);
const ANIM: Partial<Record<BlotState, string>> = {
  hero: 'idle',
  idle: 'idle',
  pending: 'pending',
  yes: 'yes',
  no: 'no',
  reveal: 'reveal',
};

interface BlotProps {
  state: BlotState;
  /** CSS width in px. The box keeps one ratio so feet stay planted while expressions change. */
  width: number | string;
  /** Lean toward the pointer (hero only). */
  lean?: boolean;
  /** Change this value to replay the hop or squish for a repeated state. */
  pulse?: string | number;
  /** Fire the doodle-star burst whenever this value changes (YES only). */
  burst?: string | number | null;
  /** Preload every expression (play desk). */
  preload?: boolean;
  /** Text alternative. Omit when the same state is already written next to Blot. */
  alt?: string;
  className?: string;
}

/**
 * Blot reacts to recorded results only. State picks the real art; idle breathes, YES hops and squashes a shadow,
 * NO squishes, pending shivers. Expressions crossfade. The pointer only matters on the hero.
 */
export function Blot({
  state,
  width,
  lean = false,
  pulse,
  burst = null,
  preload = false,
  alt,
  className = '',
}: BlotProps) {
  const reduced = useReduced();
  const [shown, setShown] = useState<{ cur: BlotState; prev: BlotState | null }>({ cur: state, prev: null });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setShown(s => (s.cur === state ? s : { cur: state, prev: s.cur }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(s => ({ ...s, prev: null })), 260);
    return () => clearTimeout(timer.current);
  }, [state]);

  usePreload(ALL, preload);

  const pointer = usePointerNorm(lean && !reduced);
  const rotate = useSpring(useTransform(pointer.x, [-1, 1], [-5, 5]), { stiffness: 90, damping: 14 });
  const shiftX = useSpring(useTransform(pointer.x, [-1, 1], [-10, 10]), { stiffness: 90, damping: 14 });

  const ratio = 1.05;
  const anim = reduced ? undefined : ANIM[shown.cur];

  return (
    <motion.span
      className={`blot-stage ${className}`}
      style={{ width, aspectRatio: `1 / ${ratio}`, ...(lean && !reduced ? { rotate, x: shiftX } : null) }}
    >
      <span
        className="blot-shadow"
        data-anim={anim === 'yes' ? 'yes' : anim === 'idle' ? 'idle' : undefined}
        key={`s-${pulse ?? ''}`}
      />
      <span className="blot-body" data-anim={anim} key={`b-${pulse ?? ''}`}>
        {shown.prev ? (
          <img
            className="blot-expr"
            src={SRC[shown.prev]}
            alt=""
            aria-hidden="true"
            data-on="false"
            draggable={false}
          />
        ) : null}
        <img
          className="blot-expr"
          src={SRC[shown.cur]}
          alt={alt ?? ''}
          aria-hidden={alt === undefined ? true : undefined}
          data-on="true"
          draggable={false}
          width={art[`blot/${shown.cur === 'hero' ? 'hero' : shown.cur}`].w}
          height={art[`blot/${shown.cur === 'hero' ? 'hero' : shown.cur}`].h}
          fetchPriority={shown.cur === 'hero' || shown.cur === 'idle' ? 'high' : undefined}
        />
      </span>
      <StarBurst fire={burst} />
    </motion.span>
  );
}

/** Blot peeking over the header rule: the logo art. */
export function BlotPeek({ width = 86 }: { width?: number }) {
  return <Art name="scenes/peek" width={width} eager className="peek-bob block" />;
}
