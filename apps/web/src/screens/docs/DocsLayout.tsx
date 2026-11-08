import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import '@/styles/docs.css';
import { useDocsIndex, type DocsOutlet } from './data';
import { OPEN_SEARCH_EVENT } from './hooks';

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** `/` focuses the search field from anywhere in the docs, like on most documentation sites. */
function useSlashKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target))
        return;
      const field = [...document.querySelectorAll<HTMLInputElement>('[data-docs-search]')].find(
        el => el.getClientRects().length > 0,
      );
      e.preventDefault();
      if (field) {
        field.focus();
        field.select();
      } else window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Loads the page index once and hands it to every docs page. */
export function DocsLayout() {
  const query = useDocsIndex();
  useSlashKey();

  if (query.isError) {
    return (
      <div className="wrap py-14">
        <InkBox className="mx-auto max-w-[640px] p-6 text-center" fill="#fff4f1" role="alert">
          <h1 className="display text-[40px] leading-none text-tomato-deep">The docs did not load</h1>
          <p className="mt-3 text-[18px] font-bold">
            The page index could not be fetched, so there is nothing to list yet. Nothing on the game was
            changed.
          </p>
          <div className="mt-4 flex justify-center">
            <Button variant="red" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        </InkBox>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="wrap min-h-[60vh] py-14" aria-busy="true">
        <p className="display text-[40px]" role="status">
          Loading the docs…
        </p>
      </div>
    );
  }
  const context: DocsOutlet = { index: query.data };
  return <Outlet context={context} />;
}
