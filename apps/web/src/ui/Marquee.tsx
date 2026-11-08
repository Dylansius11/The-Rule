import { useEffect, useRef } from 'react';
import { art } from '@/art/manifest';
import { useReduced } from '@/motion/prefs';

const NS = 'http://www.w3.org/2000/svg';
const PATH = 'M-60 120 C 180 -10, 380 -10, 640 120 S 1100 250, 1500 110';
const SPEED = 0.055; // viewBox units per ms

interface MarqueeProps {
  lines: readonly string[];
  /** Blot hangs from the ribbon. */
  hang?: boolean;
  className?: string;
}

/**
 * The grape ribbon with copy travelling along the wave, one glyph at a time.
 * Glyphs are placed on the path by hand because SMIL textPath relayout runs at about 1.5 fps.
 * The loop pauses when the ribbon is off screen and never runs under reduced motion.
 */
export function Marquee({ lines, hang = false, className = '' }: MarqueeProps) {
  const root = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const glyphs = useRef<SVGGElement>(null);
  const blot = useRef<SVGImageElement>(null);
  const reduced = useReduced();
  const message = lines.map(l => l.toUpperCase()).join(' \u2733 ') + ' \u2733 ';

  useEffect(() => {
    const path = pathRef.current;
    const g = glyphs.current;
    const host = root.current;
    if (!path || !g || !host) return;
    let cancelled = false;
    let raf = 0;
    let visible = false;
    const io = new IntersectionObserver(e => {
      visible = e.some(x => x.isIntersecting);
    });
    io.observe(host);

    void (async () => {
      await document.fonts.load('900 56px "Londrina Solid"').catch(() => undefined);
      if (cancelled) return;
      const total = path.getTotalLength();
      const meas = document.createElementNS(NS, 'text');
      g.replaceChildren(meas);
      const unit = [...message].map(ch => {
        meas.textContent = ch;
        return { ch, w: meas.getComputedTextLength() || 26 };
      });
      meas.remove();
      const period = unit.reduce((a, u) => a + u.w, 0);
      const reps = Math.ceil((total + period) / period) + 1;
      const list: { t: SVGTextElement; c: number }[] = [];
      let cum = 0;
      for (let r = 0; r < reps; r++) {
        for (const u of unit) {
          const t = document.createElementNS(NS, 'text');
          t.textContent = u.ch;
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('dy', '19');
          g.appendChild(t);
          list.push({ t, c: cum + u.w / 2 });
          cum += u.w;
        }
      }
      if (blot.current) {
        const p = path.getPointAtLength(total * 0.8);
        const w = 250;
        const h = (w * art['scenes/hanging'].h) / art['scenes/hanging'].w;
        blot.current.setAttribute('width', String(w));
        blot.current.setAttribute('height', String(h));
        blot.current.setAttribute('x', String(p.x - w / 2));
        blot.current.setAttribute('y', String(p.y + 22 - h * 0.1));
      }
      let s = 0;
      const draw = () => {
        for (const gl of list) {
          const pos = gl.c - s;
          if (pos < 0 || pos > total) {
            gl.t.style.display = 'none';
            continue;
          }
          gl.t.style.display = '';
          const p = path.getPointAtLength(pos);
          const q = path.getPointAtLength(Math.min(total, pos + 1));
          const a = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
          gl.t.setAttribute(
            'transform',
            `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${a.toFixed(1)})`,
          );
        }
      };
      draw();
      if (reduced) return;
      let last = performance.now();
      const loop = (now: number) => {
        const dt = now - last;
        last = now;
        if (visible) {
          s = (s + dt * SPEED) % period;
          draw();
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [message, reduced]);

  return (
    <div
      ref={root}
      className={`pointer-events-none relative z-[3] -mb-24 -mt-16 ${className}`}
      style={{ height: 'clamp(150px, 18vw, 260px)' }}
    >
      <p className="sr-only">{lines.join('. ')}</p>
      <svg
        className="block h-full w-full overflow-visible"
        viewBox="0 0 1440 260"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <path ref={pathRef} d={PATH} fill="none" />
        <path
          d={PATH}
          stroke="#141210"
          strokeWidth="126"
          fill="none"
          strokeLinecap="round"
          style={{ filter: 'url(#ink-wob-big)' }}
        />
        <path
          d={PATH}
          stroke="#6E3BFF"
          strokeWidth="112"
          fill="none"
          strokeLinecap="round"
          style={{ filter: 'url(#ink-wob-big)' }}
        />
        <g ref={glyphs} className="marquee-glyphs" />
        {hang ? <image ref={blot} href={art['scenes/hanging'].src} className="peek-bob" /> : null}
      </svg>
    </div>
  );
}
