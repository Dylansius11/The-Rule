import { motion, useSpring, useTransform } from 'motion/react';
import { usePointerNorm } from '@/motion/hooks';
import { useReduced } from '@/motion/prefs';

/** The giant drawn eye. The iris follows the pointer; on touch it rests. Decorative: the headline carries the meaning. */
export function Eye({ className = '' }: { className?: string }) {
  const reduced = useReduced();
  const p = usePointerNorm(!reduced);
  const x = useSpring(useTransform(p.x, [-1, 1], [-34, 34]), { stiffness: 120, damping: 16 });
  const y = useSpring(useTransform(p.y, [-1, 1], [-18, 18]), { stiffness: 120, damping: 16 });
  return (
    <svg viewBox="0 0 400 260" className={className} aria-hidden="true" style={{ overflow: 'visible' }}>
      <ellipse cx="200" cy="130" rx="190" ry="124" fill="#FFFBEA" stroke="#FFFBEA" strokeWidth="3" />
      <ellipse
        cx="200"
        cy="130"
        rx="190"
        ry="124"
        fill="none"
        stroke="#FF3B1F"
        strokeWidth="12"
        style={{ filter: 'url(#ink-wob2)' }}
      />
      <motion.g style={{ x, y }}>
        <ellipse cx="200" cy="136" rx="92" ry="104" fill="#141210" />
        <ellipse cx="160" cy="88" rx="16" ry="22" fill="#fff" transform="rotate(18 160 88)" />
        <ellipse cx="236" cy="190" rx="7" ry="9" fill="#fff" opacity="0.5" />
      </motion.g>
    </svg>
  );
}

/** A sealed envelope on the ink: cream paper, sun outline, wax seal with a keyhole. `seal` is 0..1 and scales the wax. */
export function SealedEnvelope({
  seal = 1,
  className = '',
}: {
  seal?: number | import('motion/react').MotionValue<number>;
  className?: string;
}) {
  return (
    <svg viewBox="-60 -50 120 100" className={className} aria-hidden="true" style={{ overflow: 'visible' }}>
      <rect x="-50" y="-34" width="100" height="68" rx="5" fill="#FFFBEA" stroke="#FFE814" strokeWidth="3" />
      <path d="M-50 -34 L0 8 L50 -34" fill="none" stroke="#FFE814" strokeWidth="3" strokeLinejoin="round" />
      <motion.g
        style={{ scale: seal, transformBox: 'fill-box', transformOrigin: 'center' }}
        transform="translate(0 8)"
      >
        <path
          d="M0 -19 C7 -22 12 -17 16 -13 C22 -11 24 -4 21 2 C23 8 19 14 13 15 C9 21 2 22 -3 19 C-9 22 -15 18 -16 12 C-22 9 -22 1 -19 -4 C-20 -10 -15 -15 -10 -15 C-7 -19 -4 -20 0 -19 Z"
          fill="#FF3B1F"
          stroke="#141210"
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <circle cx="0" cy="0" r="12" fill="none" stroke="#C92B14" strokeWidth="2" strokeDasharray="3 3" />
        <path d="M0 -6 a3.4 3.4 0 0 1 2.4 5.8 L3.6 7 H-3.6 L-2.4 -0.2 A3.4 3.4 0 0 1 0 -6 Z" fill="#7d1306" />
      </motion.g>
    </svg>
  );
}
