import { useRef, type CSSProperties } from 'react';
import { useReduced } from '@/motion/prefs';

interface LettersProps {
  text: string;
  className?: string;
  style?: CSSProperties;
}

/** Display lettering where each glyph rests at its own tilt and lifts toward the pointer (250 ms spring). The text stays one accessible string. */
export function Letters({ text, className = '', style }: LettersProps) {
  const root = useRef<HTMLSpanElement>(null);
  const reduced = useReduced();
  const glyphs = [...text];

  function move(e: React.PointerEvent) {
    if (reduced || e.pointerType === 'touch' || !root.current) return;
    for (const el of root.current.querySelectorAll<HTMLElement>('[data-rot]')) {
      const b = el.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
      const k = Math.max(0, 1 - d / 120);
      const rest = Number(el.dataset.rot);
      el.style.transform = `rotate(${rest * (1 - k) + k * 10}deg) translateY(${-k * 16}px) scale(${1 + k * 0.12})`;
    }
  }
  function leave() {
    if (!root.current) return;
    for (const el of root.current.querySelectorAll<HTMLElement>('[data-rot]'))
      el.style.transform = `rotate(${el.dataset.rot}deg)`;
  }

  return (
    <span
      ref={root}
      className={className}
      style={style}
      aria-label={text}
      role="img"
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {glyphs.map((ch, i) => {
        const rot = (((i * 37) % 11) - 5) * 1.1;
        return (
          <span
            key={i}
            aria-hidden="true"
            data-rot={rot}
            className="letter-pop"
            style={{ transform: `rotate(${rot}deg) translateY(${((i * 13) % 7) - 3}px)` }}
          >
            {ch === ' ' ? '\u00A0' : ch}
          </span>
        );
      })}
    </span>
  );
}
