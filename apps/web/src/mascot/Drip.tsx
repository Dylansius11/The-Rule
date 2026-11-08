import { Art } from '@/art/Art';

export type DripPose = 'crawl' | 'peek' | 'asleep' | 'startled';

/** Drip, the pink sidekick: crawls on progress bars, peeks over cards, sleeps in empty results, startles on errors. Never a cursor follower. */
export function Drip({
  pose,
  width = 120,
  className = '',
  alt,
}: {
  pose: DripPose;
  width?: number;
  className?: string;
  alt?: string;
}) {
  return <Art name={`drip/${pose}`} width={width} alt={alt} className={className} />;
}
