import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from '@/layout/AppShell';
import { LandingShell } from '@/layout/LandingShell';
import { Root } from '@/layout/Root';
import { MotionPrefsProvider } from '@/motion/prefs';
import { Landing } from '@/screens/landing/Landing';
import { RouteError } from './RouteError';

/** Load a named page export on first visit, so the landing page ships alone in the first chunk. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ReactNode {
  const Page = lazy<ComponentType>(() => load().then(module => ({ default: module[name] })));
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <Page />
    </Suspense>
  );
}

const devRoutes = import.meta.env.DEV
  ? [{ path: 'dev/states', element: page(() => import('@/screens/DevStates'), 'DevStates') }]
  : [];

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        element: <LandingShell />,
        children: [{ index: true, element: <Landing />, errorElement: <RouteError /> }],
      },
      {
        element: <AppShell />,
        children: [
          { path: 'log', element: page(() => import('@/screens/LogPage'), 'LogPage') },
          { path: 'guess', element: page(() => import('@/screens/GuessPage'), 'GuessPage') },
          { path: 'reveal', element: page(() => import('@/screens/RevealPage'), 'RevealPage') },
          { path: 'team', element: page(() => import('@/screens/TeamPage'), 'TeamPage') },
          { path: 'wallet', element: page(() => import('@/screens/WalletPage'), 'WalletPage') },
          { path: 'season', element: page(() => import('@/screens/season/SeasonPage'), 'SeasonPage') },
          ...devRoutes,
          { path: '*', element: page(() => import('@/screens/NotFound'), 'NotFound') },
        ],
      },
    ],
  },
]);

export function AppRouter() {
  return (
    <MotionPrefsProvider>
      <RouterProvider router={router} />
    </MotionPrefsProvider>
  );
}
