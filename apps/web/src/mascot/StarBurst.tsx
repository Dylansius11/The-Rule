import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Art } from '@/art/Art';
import type { ArtName } from '@/art/manifest';
import { useReduced } from '@/motion/prefs';

const KINDS: ArtName[] = [
  'doodles/star-yellow',
  'doodles/star-pink',
  'doodles/sparkle',
  'doodles/star-outline',
  'doodles/burst',
];
const COUNT = 9;

/** Nine doodle stars fly out from the centre of the nearest positioned parent. Fires when `fire` changes to a value. */
export function StarBurst({ fire }: { fire: string | number | null }) {
  const reduced = useReduced();
  const [live, setLive] = useState<string | number | null>(null);
  useEffect(() => {
    if (fire === null || reduced) return;
    setLive(fire);
    const id = setTimeout(() => setLive(null), 1100);
    return () => clearTimeout(id);
  }, [fire, reduced]);
  if (live === null) return null;
  return (
    <span className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {Array.from({ length: COUNT }, (_, i) => {
        const a = (i / COUNT) * Math.PI * 2 + (i % 2) * 0.3;
        const d = 120 + ((i * 37) % 60);
        const size = 26 + ((i * 13) % 22);
        return (
          <motion.span
            key={`${live}-${i}`}
            className="absolute left-1/2 top-[46%]"
            style={{ width: size, marginLeft: -size / 2, marginTop: -size / 2 }}
            initial={{ x: 0, y: 0, scale: 0.2, rotate: 0, opacity: 1 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d, scale: 1, rotate: 200, opacity: 0 }}
            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Art name={KINDS[i % KINDS.length]!} width={size} />
          </motion.span>
        );
      })}
    </span>
  );
}
