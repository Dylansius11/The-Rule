import { toUiError } from '@/chain/errors';
import type { RoundHistory } from '@/game';
import { ErrorCard } from '@/ui/ErrorCard';

/** A bounded lookup is not a complete archive, and failed reads are not missing rounds. */
export function RoundHistoryNotice({ history }: { history: RoundHistory }) {
  return (
    <div className="mt-3 text-[15px] font-semibold" aria-live="polite">
      {history.loading ? <p aria-busy="true">Checking recent round records…</p> : null}
      {history.error ? <ErrorCard error={toUiError(history.error)} onRetry={history.retry} /> : null}
      {history.from !== null ? (
        <p className="mt-2">
          Only observed rounds are listed. Checked IDs {history.from}–{history.to};{' '}
          {history.error ? 'some reads failed. ' : ''}
          {history.limited ? 'Older rounds are outside this lookup window. ' : ''}
          Open a known older round with ?round=ID in the URL.
        </p>
      ) : null}
    </div>
  );
}
