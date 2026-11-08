import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from '@/layout/AppShell';
import { MotionPrefsProvider } from '@/motion/prefs';
import { Home } from '@/screens/Home';

/** Load a named page export on first visit, so Home ships alone in the first chunk. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ReactNode {
  const Page = lazy<ComponentType>(() => load().then(module => ({ default: module[name] })));
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <Page />
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'log', element: page(() => import('@/screens/LogPage'), 'LogPage') },
      { path: 'guess', element: page(() => import('@/screens/GuessPage'), 'GuessPage') },
      { path: 'reveal', element: page(() => import('@/screens/RevealPage'), 'RevealPage') },
      { path: '*', element: page(() => import('@/screens/NotFound'), 'NotFound') },
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
