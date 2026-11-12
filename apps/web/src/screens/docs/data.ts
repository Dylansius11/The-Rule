import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useSound } from '@/audio';
import type { DocsIndex } from '@/docs/types';
import { copyText, fetchText } from './agentContext';

const FIVE_MINUTES = 5 * 60_000;

async function fetchIndex(): Promise<DocsIndex> {
  const res = await fetch('/docs/index.json');
  if (!res.ok) throw new Error(`index: ${res.status}`);
  const data = (await res.json()) as DocsIndex;
  if (!Array.isArray(data.sections)) throw new Error('index: unexpected shape');
  return data;
}

export const useDocsIndex = () =>
  useQuery({ queryKey: ['docs', 'index'], queryFn: fetchIndex, staleTime: FIVE_MINUTES });

/** Raw text of a generated file (a page, `/CONTEXT.md`), cached for the session. */
export const useDocText = (path: string) =>
  useQuery({ queryKey: ['docs', 'text', path], queryFn: () => fetchText(path), staleTime: FIVE_MINUTES });

/** Same file, but fetched on demand (a click), reusing the cache when it is warm. */
export function useTextLoader() {
  const client = useQueryClient();
  return useCallback(
    (path: string) =>
      client.fetchQuery({
        queryKey: ['docs', 'text', path],
        queryFn: () => fetchText(path),
        staleTime: FIVE_MINUTES,
      }),
    [client],
  );
}

/** What the layout hands to its pages. */
export interface DocsOutlet {
  index: DocsIndex;
}

export const useDocsOutlet = () => useOutletContext<DocsOutlet>();

export type CopyState = { kind: 'idle' } | { kind: 'ok'; what: string } | { kind: 'error'; what: string };

const RESET_MS = 2600;

/**
 * One copy action with a visible outcome. `copy` runs the loader, writes the clipboard and reports; the state
 * returns to idle after a moment. A failure is never silent: the state says it, and the caller shows it.
 */
export function useCopy() {
  const { play } = useSound();
  const [state, setState] = useState<CopyState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (what: string, load: () => Promise<string> | string) => {
      clearTimeout(timer.current);
      setBusy(true);
      let ok = false;
      try {
        ok = await copyText(await load());
      } catch {
        ok = false;
      }
      setBusy(false);
      play(ok ? 'success' : 'error');
      setState(ok ? { kind: 'ok', what } : { kind: 'error', what });
      timer.current = setTimeout(() => setState({ kind: 'idle' }), RESET_MS);
      return ok;
    },
    [play],
  );
  return { state, busy, copy };
}

/** Screen-reader and visible sentence for a copy outcome. */
export function copyMessage(state: CopyState): string {
  if (state.kind === 'ok') return `Copied ${state.what} to the clipboard.`;
  if (state.kind === 'error') {
    return `Could not copy ${state.what}: the browser blocked clipboard access or the file did not load. Use Open raw instead.`;
  }
  return '';
}
