import { Outlet } from 'react-router';
import { ErrorCard } from '@/ui/ErrorCard';
import { AppFooter } from './AppFooter';
import { AppHeader } from './AppHeader';
import { SessionNotice } from './SessionNotice';
import { TabBar } from './TabBar';
import { useConnect } from './useConnect';

/** Frame around the game (room, season, account): app header, slim footer, bottom tabs on phones. */
export function AppShell() {
  const { error, clear, connect } = useConnect();
  return (
    <div className="pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] md:pb-0">
      <AppHeader />
      {error ? (
        <div className="wrap mt-3">
          <ErrorCard error={error} onRetry={connect} onDismiss={clear} />
        </div>
      ) : null}
      <SessionNotice />
      <main id="main" tabIndex={-1} className="overflow-x-clip outline-none">
        <Outlet />
      </main>
      <AppFooter />
      <TabBar />
    </div>
  );
}
