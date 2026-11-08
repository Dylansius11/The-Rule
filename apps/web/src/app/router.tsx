import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, redirect, RouterProvider, type LoaderFunctionArgs } from 'react-router';
import { AppShell } from '@/layout/AppShell';
import { LandingShell } from '@/layout/LandingShell';
import { Root } from '@/layout/Root';
import { MotionPrefsProvider } from '@/motion/prefs';
import { Landing } from '@/screens/landing/Landing';
import { NotFound } from '@/screens/NotFound';
import { modeFromQuery, modeOf, roomPath, type RoomTab } from './paths';
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

/** Old flat URLs keep working: `?mode=1` means Team, `?round=` carries over. */
function legacyRoom(tab: RoomTab) {
  return ({ request }: LoaderFunctionArgs) => {
    const params = new URL(request.url).searchParams;
    const raw = params.get('round');
    const round = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    return redirect(roomPath(modeFromQuery(params.get('mode')), tab, round));
  };
}

/** Only `solo` and `team` are rooms. Anything else is a 404 rendered inside the app frame. */
function roomLoader({ params }: LoaderFunctionArgs) {
  if (modeOf(params.mode) === null) throw new Response('Not found', { status: 404 });
  return null;
}

/** The crew desk belongs to Team. `/play/solo/crew` goes back to the Solo room. */
function crewLoader({ params }: LoaderFunctionArgs) {
  return params.mode === 'team' ? null : redirect(roomPath(0));
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
          {
            errorElement: <RouteError />,
            children: [
              { path: 'play', loader: () => redirect(roomPath(0)) },
              {
                path: 'play/:mode',
                loader: roomLoader,
                element: page(() => import('@/screens/play/RoomLayout'), 'RoomLayout'),
                children: [
                  { index: true, element: page(() => import('@/screens/play/StampTab'), 'StampTab') },
                  { path: 'ledger', element: page(() => import('@/screens/LogPage'), 'LogPage') },
                  { path: 'guess', element: page(() => import('@/screens/play/GuessTab'), 'GuessTab') },
                  { path: 'verify', element: page(() => import('@/screens/RevealPage'), 'RevealPage') },
                  {
                    path: 'crew',
                    loader: crewLoader,
                    element: page(() => import('@/screens/TeamPage'), 'TeamPage'),
                  },
                ],
              },
              { path: 'season', element: page(() => import('@/screens/season/SeasonPage'), 'SeasonPage') },
              {
                path: 'account',
                element: page(() => import('@/screens/WalletPage'), 'WalletPage'),
              },
              { path: 'log', loader: legacyRoom('ledger') },
              { path: 'guess', loader: legacyRoom('guess') },
              { path: 'reveal', loader: legacyRoom('verify') },
              { path: 'team', loader: () => redirect(roomPath(1, 'crew')) },
              { path: 'wallet', loader: () => redirect('/account') },
              ...devRoutes,
              { path: '*', element: <NotFound /> },
            ],
          },
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
