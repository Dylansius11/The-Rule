import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { InkBox } from './InkBox';

/** A hand-lettered line from Blot. The bubble pops each time the line changes. */
export function SpeechBubble({
  children,
  id,
  className = '',
}: {
  children: ReactNode;
  id?: string | number;
  className?: string;
}) {
  return (
    <motion.div
      key={id}
      initial={{ scale: 0.85, rotate: -2 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 18 }}
      className={`mx-auto max-w-[24ch] ${className}`}
    >
      <InkBox className="bubble" small>
        {children}
      </InkBox>
    </motion.div>
  );
}
