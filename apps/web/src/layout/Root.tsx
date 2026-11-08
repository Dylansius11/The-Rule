import { Outlet, ScrollRestoration } from 'react-router';
import { InkDefs } from '@/ui/InkDefs';
import { GuideProvider } from './guide';
import { HowToPlay } from './HowToPlay';

/** The outermost frame of every route: skip link, ink filters, the how-to-play guide and scroll restoration. */
export function Root() {
  return (
    <GuideProvider>
      <InkDefs />
      <a
        href="#main"
        className="absolute left-3 top-3 z-[60] -translate-y-24 rounded-lg border-[3px] border-ink bg-sun px-4 py-3 font-display text-xl font-black uppercase focus:translate-y-0"
      >
        Skip to content
      </a>
      <Outlet />
      <HowToPlay />
      <ScrollRestoration />
    </GuideProvider>
  );
}
