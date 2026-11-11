import { lazy, Suspense, useState } from 'react';
import { useSound } from '@/audio';
import { useReduced } from '@/motion/prefs';
import { Blot } from './Blot';

const Blot3D = lazy(() => import('./Blot3D'));

interface HeroBlotProps {
  className?: string;
}

/**
 * The hero mascot. Fills its container's width at the 2D art's ratio, so nothing shifts when the
 * 3D Blot takes over. The inked 2D Blot stays for reduced motion, missing WebGL and lost contexts.
 */
export function HeroBlot({ className = '' }: HeroBlotProps) {
  const reduced = useReduced();
  const { play } = useSound();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const show3d = !reduced && !failed;

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
