import { useMotionValue, type MotionValue } from 'motion/react';
import { useEffect, useRef, useState, type RefObject } from 'react';

/** True while the element intersects the viewport (plus margin). Used to pause marquee and loops off screen. */
export function useOnScreen<T extends Element>(ref: RefObject<T | null>, margin = '120px'): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), {
      rootMargin: margin,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return visible;
}

/**
 * Pointer position normalised to -1..1 across the viewport. Touch devices never move it, so it rests at 0.
 * Attaches a single passive listener while `active` is true.
 */
export function usePointerNorm(active = true): { x: MotionValue<number>; y: MotionValue<number> } {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  useEffect(() => {
    if (!active) return;
    const on = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      x.set((e.clientX / window.innerWidth) * 2 - 1);
      y.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    addEventListener('pointermove', on, { passive: true });
    return () => removeEventListener('pointermove', on);
  }, [active, x, y]);
  return { x, y };
}

/** Preload a list of image URLs once. */
export function usePreload(urls: readonly string[], enabled = true) {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    for (const url of urls) {
      const img = new Image();
      img.src = url;
    }
  }, [urls, enabled]);
}

/** A ticking "now" in epoch ms, for relative times. While `enabled` is false it does not tick. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

/** Types `text` out one character at a time while `active` (38 ms each). Instant when `instant` (reduced motion). */
export function useTypewriter(text: string, active: boolean, instant: boolean, msPerChar = 38): string {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    if (instant) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const id = setInterval(
      () => setCount(c => (c >= text.length ? (clearInterval(id), c) : c + 1)),
      msPerChar,
    );
    return () => clearInterval(id);
  }, [text, active, instant, msPerChar]);
  return text.slice(0, count);
}

/** Counts a number up (or down) to `target` over `ms` with an ease-out. Instant when `instant`. */
export function useCountUp(target: number, instant: boolean, ms = 900): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (instant || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const value = origin + (target - origin) * (1 - Math.pow(1 - p, 3));
      setShown(value);
      from.current = value;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, instant, ms]);
  return shown;
}
