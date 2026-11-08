import type { ReactNode } from 'react';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
}

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 28 28" aria-hidden="true">
    {children}
  </svg>
);

export const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Play',
    end: true,
    icon: svg(
      <>
        <path d="M9 6h10v8l3 3v3H6v-3l3-3z" />
        <path d="M5 24h18" />
      </>,
    ),
  },
  {
    to: '/log',
    label: 'Log',
    icon: svg(
      <>
        <path d="M7 5h14v18H7z" />
        <path d="M10.5 10h7M10.5 14h7M10.5 18h4" />
      </>,
    ),
  },
  {
    to: '/guess',
    label: 'Guess',
    icon: svg(
      <>
        <path d="M4 8h20v13H4z" />
        <path d="m4 8 10 8 10-8" />
      </>,
    ),
  },
  {
    to: '/reveal',
    label: 'Reveal',
    icon: svg(
      <>
        <path d="M2.5 14S7 6.5 14 6.5 25.5 14 25.5 14 21 21.5 14 21.5 2.5 14 2.5 14z" />
        <circle cx="14" cy="14" r="3.6" />
      </>,
    ),
  },
  {
    to: '/wallet',
    label: 'Wallet',
    icon: svg(
      <>
        <path d="M4 8h18v14H4z" />
        <path d="M4 8l3-3h13v3" />
        <circle cx="18" cy="15" r="1.4" />
      </>,
    ),
  },
];

export const MORE: { to: string; label: string; note: string }[] = [
  { to: '/team', label: 'Team', note: 'The heron’s team desk: roster, vault, locks.' },
  { to: '/season', label: 'Season', note: 'Ledger-style boards for Solo and Team.' },
];

export const DESKTOP_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Play', end: true },
  { to: '/log', label: 'Log' },
  { to: '/guess', label: 'Guess' },
  { to: '/reveal', label: 'Reveal' },
  { to: '/team', label: 'Team' },
  { to: '/season', label: 'Season' },
];

export const MoreIcon = () =>
  svg(
    <>
      <circle cx="6" cy="14" r="1.8" />
      <circle cx="14" cy="14" r="1.8" />
      <circle cx="22" cy="14" r="1.8" />
    </>,
  );
