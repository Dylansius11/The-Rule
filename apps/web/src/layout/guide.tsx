import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

const SEEN_KEY = 'the-rule:guide-seen';

interface GuideContextValue {
  open: boolean;
  show: () => void;
  hide: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage can be blocked; the guide then opens once per visit */
  }
}

function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Owns whether the how-to-play modal is open. It opens by itself on a player's first visit to /play, and on
 * `?guide=1` (the parameter is removed again so a reload does not reopen it).
 */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('guide') === '1') {
      setOpen(true);
      params.delete('guide');
      const rest = params.toString();
      void navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true });
    } else if (pathname.startsWith('/play') && !hasSeen()) {
      setOpen(true);
    }
  }, [pathname, search, navigate]);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    markSeen();
  }, []);
  // Showing the guide counts as seeing it, so closing it any way never brings it back on its own.
  useEffect(() => {
    if (open) markSeen();
  }, [open]);

  const value = useMemo(() => ({ open, show, hide }), [open, show, hide]);
  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

export function useGuide(): GuideContextValue {
  const value = useContext(GuideContext);
  if (!value) throw new Error('GuideProvider missing');
  return value;
}
