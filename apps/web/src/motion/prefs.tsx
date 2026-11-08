import { MotionConfig } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'rule.reduceMotion';
const QUERY = '(prefers-reduced-motion: reduce)';

interface MotionPrefs {
  /** True when either the OS or the in-app switch asks for reduced motion. */
  reduced: boolean;
  /** The in-app switch only. */
  userReduced: boolean;
  setUserReduced(next: boolean): void;
}

const MotionPrefsContext = createContext<MotionPrefs>({
  reduced: false,
  userReduced: false,
  setUserReduced: () => undefined,
});

export function MotionPrefsProvider({ children }: { children: ReactNode }) {
  const [os, setOs] = useState(() => typeof matchMedia === 'function' && matchMedia(QUERY).matches);
  const [userReduced, setUser] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = matchMedia(QUERY);
    const on = () => setOs(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const reduced = os || userReduced;
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [reduced]);
  const setUserReduced = useCallback((next: boolean) => {
    setUser(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* storage can be blocked; the switch still works for this session */
    }
  }, []);
  const value = useMemo(
    () => ({ reduced, userReduced, setUserReduced }),
    [reduced, userReduced, setUserReduced],
  );
  return (
    <MotionPrefsContext.Provider value={value}>
      <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>{children}</MotionConfig>
    </MotionPrefsContext.Provider>
  );
}

export const useMotionPrefs = () => useContext(MotionPrefsContext);
export const useReduced = () => useContext(MotionPrefsContext).reduced;
