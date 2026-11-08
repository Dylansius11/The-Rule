import { Outlet } from 'react-router';
import { ErrorCard } from '@/ui/ErrorCard';
import { Header } from './Header';
import { LandingFooter } from './LandingFooter';
import { TabBar } from './TabBar';
import { useConnect } from './useConnect';

/** Frame around the app pages: header, deployment strip, tabs, footer. Root owns the skip link and filters. */
export function AppShell() {
  const { error, clear, connect } = useConnect();
  return (
    <>
      <Header />
      {error ? (
        <div className="wrap mt-3">
          <ErrorCard error={error} onRetry={connect} onDismiss={clear} />
        </div>
      ) : null}
      <main id="main" tabIndex={-1} className="overflow-x-clip outline-none">
        <Outlet />
      </main>
      <LandingFooter />
      <TabBar />
    </>
  );
}
