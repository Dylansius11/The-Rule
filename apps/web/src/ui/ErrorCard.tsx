import type { UiError } from '@/game/types';
import { Drip } from '@/mascot/Drip';
import { Button } from './Button';
import { InkBox } from './InkBox';

interface ErrorCardProps {
  error: UiError;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/** Every failure says what happened, whether funds moved, and the next step. Drip startles. */
export function ErrorCard({ error, onRetry, onDismiss, className = '' }: ErrorCardProps) {
  return (
    <InkBox
      fill="#fff4f1"
      role="alert"
      className={`relative flex flex-col gap-2 p-4 pb-5 text-left ${className}`}
    >
      <div className="flex items-start gap-3">
        <Drip pose="startled" width={84} className="shrink-0" />
        <div className="min-w-0">
          <h3 className="display text-[28px] leading-none text-tomato-deep">
            {error.title}
            {error.code ? (
              <span className="mono ml-2 align-middle text-[13px] font-bold text-ink">{error.code}</span>
            ) : null}
          </h3>
          <p className="mt-2 font-extrabold">{error.funds}</p>
          <p className="mt-1">{error.next}</p>
        </div>
      </div>
      {onRetry || onDismiss ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {onRetry && error.retryable ? (
            <Button variant="red" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="paper" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          ) : null}
        </div>
      ) : null}
    </InkBox>
  );
}
