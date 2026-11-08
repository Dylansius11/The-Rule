import { Art } from '@/art/Art';

export type HeronPose = 'vest' | 'suit';

/** The heron clerk keeps the public ledger and the Team desk. Never the referee, never stamps a verdict. */
export function Heron({
  pose,
  width = 160,
  className = '',
  alt,
}: {
  pose: HeronPose;
  width?: number;
  className?: string;
  alt?: string;
}) {
  return <Art name={`heron/${pose}`} width={width} alt={alt} className={className} />;
}
