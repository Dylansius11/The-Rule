import { Outlet, ScrollRestoration } from 'react-router';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkDefs } from '@/ui/InkDefs';
import { Footer } from './Footer';
import { Header } from './Header';
import { TabBar } from './TabBar';
import { useConnect } from './useConnect';

/** Frame around every route: skip link, filters, deployment strip, header, tabs, footer. */
export function AppShell() {
  const { error, clear, connect } = useConnect();
  return (
    <>
      <InkDefs />
      <a
        href="#main"
        className="absolute left-3 top-3 z-[60] -translate-y-24 rounded-lg border-[3px] border-ink bg-sun px-4 py-3 font-display text-xl font-black uppercase focus:translate-y-0"
      >
        Skip to content
      </a>
      <Header />
      {error ? (
        <div className="wrap mt-3">
          <ErrorCard error={error} onRetry={connect} onDismiss={clear} />
        </div>
      ) : null}
      <main id="main" tabIndex={-1} className="overflow-x-clip outline-none">
        <Outlet />
      </main>
      <Footer />
      <TabBar />
      <ScrollRestoration />
    </>
  );
}
