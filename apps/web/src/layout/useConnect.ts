import { useState } from 'react';
import { toUiError } from '@/chain/errors';
import { useWallet } from '@/game';
import type { UiError } from '@/game/types';

/** Connect with a visible failure state. Shared by the header chip, the play desk and the wallet page. */
export function useConnect() {
  const wallet = useWallet();
  const [error, setError] = useState<UiError | null>(null);
  const busy = wallet.status === 'connecting';
  function connect() {
    setError(null);
    wallet.connect().catch((e: unknown) => setError(toUiError(e)));
  }
  return { wallet, connect, busy, error, clear: () => setError(null) };
}
