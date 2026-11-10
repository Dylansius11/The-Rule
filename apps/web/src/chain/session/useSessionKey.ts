import { useSyncExternalStore } from 'react';
import { dismissNotice, enable, getSnapshot, refresh, revoke, subscribe } from './state';

/** Live session key status plus the two wallet-approved actions. */
export function useSessionKey() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, enable, revoke, refresh, dismissNotice };
}

/** What to say while a call is being signed: the wallet popup or the session key. */
export function useSigningCopy() {
  const { via } = useSessionKey();
  return via === 'session'
    ? {
        title: 'Signing with your session key.',
        note: 'No wallet popup for this one. It is sent straight to the chain.',
      }
    : { title: 'Your wallet is open.', note: 'Nothing is charged until you approve.' };
}
