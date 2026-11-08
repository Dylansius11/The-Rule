import { art } from '@/art/manifest';
import { LiveRegion } from '@/ui/LiveRegion';
import { copyMessage, useCopy } from './data';

const GROUPS = (() => {
  const byFolder = new Map<string, { name: string; src: string; w: number; h: number }[]>();
  for (const [name, entry] of Object.entries(art)) {
    const folder = name.split('/')[0]!;
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), { name, ...entry }]);
  }
  return [...byFolder];
})();

function CopyPath({ path }: { path: string }) {
  const { state, copy } = useCopy();
  return (
    <>
      <button
        type="button"
        className="doc-copy"
        data-state={state.kind}
        aria-label={`Copy path ${path}`}
        onClick={() => void copy('the path', () => path)}
      >
        {state.kind === 'ok' ? 'Copied' : state.kind === 'error' ? 'Failed' : 'Copy'}
      </button>
      <LiveRegion message={copyMessage(state)} />
    </>
  );
}

/** Every served art file from the generated manifest: the real image, its name, path and size. */
export function BrandGallery() {
  const total = GROUPS.reduce((n, [, items]) => n + items.length, 0);
  return (
    <section aria-labelledby="gallery-title" className="doc-gallery doc-prose">
      <h2 id="gallery-title" className="doc-h">
        Gallery
      </h2>
      <p>
        All {total} images the app serves, straight from the art manifest. The path is where each file is
        served; sizes are the intrinsic pixels.
      </p>
      {GROUPS.map(([folder, items]) => (
        <div key={folder}>
          <h3 className="doc-h">{folder}</h3>
          <ul className="doc-gallery-grid">
            {items.map(item => (
              <li key={item.name}>
                <div className="doc-gallery-tile">
                  <img
                    src={item.src}
                    width={item.w}
                    height={item.h}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <p className="doc-gallery-name">{item.name}</p>
                <p className="doc-gallery-meta mono">
                  {item.w} × {item.h}
                </p>
                <p className="doc-gallery-path">
                  <code>{item.src}</code>
                </p>
                <CopyPath path={item.src} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
