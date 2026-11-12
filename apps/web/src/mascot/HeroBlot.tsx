import { lazy, Suspense, useEffect, useState } from 'react';
import { useSound } from '@/audio';
import { useReduced } from '@/motion/prefs';
import { Blot } from './Blot';

const Blot3D = lazy(() => import('./Blot3D'));

interface HeroBlotProps {
  className?: string;
}

/** Wait for the page's own load event, then an idle moment, so the 569 kB 3D chunk never competes with first paint. */
function whenIdle(run: () => void): () => void {
  let cancelled = false;
  let handle = 0;
  const start = () => {
    if (cancelled) return;
    handle = window.setTimeout(() => !cancelled && run(), 1200);
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  return () => {
    cancelled = true;
    window.clearTimeout(handle);
    window.removeEventListener('load', start);
  };
}

/**
 * The hero mascot. Fills its container's width at the 2D art's ratio, so nothing shifts when the
 * 3D Blot takes over. The inked 2D Blot is what first paint shows; the 3D model is fetched only after the page
 * has loaded and settled, and never at all for reduced motion, missing WebGL and lost contexts.
 */
export function HeroBlot({ className = '' }: HeroBlotProps) {
  const reduced = useReduced();
  const { play } = useSound();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => (reduced ? undefined : whenIdle(() => setArmed(true))), [reduced]);
  const show3d = !reduced && !failed && armed;
  return (
    <div className={`relative w-full ${className}`}>
      <div className={`transition-opacity duration-500 ${show3d && ready ? 'opacity-0' : 'opacity-100'}`}>
        <Blot state="hero" width="100%" lean={!show3d} />
      </div>
      {show3d ? (
        <Suspense fallback={null}>
          <Blot3D
            className="absolute -inset-x-[8%] -top-[4%] bottom-0"
            onReady={() => setReady(true)}
            onError={() => setFailed(true)}
            onPoke={() => play('jump')}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
