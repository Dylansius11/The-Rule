import { Navigate, useParams } from 'react-router';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { useDocsOutlet } from './data';
import { DocsSearch } from './DocsSearch';
import { useDocumentTitle } from './hooks';
import { DOCS_HOME, docRoute, docTitle, findSection } from './model';

/** An address under /docs that is not a page: say so, and offer search and the way home. */
export function DocsMissing() {
  useDocumentTitle(docTitle('No such page', 'Docs'));
  return (
    <div className="wrap py-10 md:py-16">
      <EmptyState
        art="stickers/asleep"
        artWidth={170}
        title="No such page in the docs"
        className="mx-auto max-w-[760px]"
        actions={
          <Button to={DOCS_HOME} variant="red">
            Docs home
          </Button>
        }
      >
        <p>Nothing lives at this address. Search for what you were after:</p>
        <div className="mt-4 text-left">
          <DocsSearch variant="inline" large />
        </div>
      </EmptyState>
    </div>
  );
}

/** `/docs/play` opens the first page of that section; an unknown section is a missing page. */
export function DocsSection() {
  const { index } = useDocsOutlet();
  const { section } = useParams();
  const first = findSection(index, section)?.entries[0];
  return first ? <Navigate to={docRoute(first)} replace /> : <DocsMissing />;
}
