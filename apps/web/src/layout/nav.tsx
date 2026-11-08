import type { ReactNode } from 'react';
import type { RoomTab } from '@/app/paths';

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 28 28" aria-hidden="true">
    {children}
  </svg>
);

/** The four tabs of a round room, in play order. Crew is a fifth, Team only (see RoomLayout). */
export const ROOM_TABS: { tab: Exclude<RoomTab, 'crew'>; label: string; icon: ReactNode }[] = [
  {
    tab: 'stamp',
    label: 'Stamp',
    icon: svg(
      <>
        <path d="M9 6h10v8l3 3v3H6v-3l3-3z" />
        <path d="M5 24h18" />
      </>,
    ),
  },
  {
    tab: 'ledger',
    label: 'Ledger',
    icon: svg(
      <>
        <path d="M7 5h14v18H7z" />
        <path d="M10.5 10h7M10.5 14h7M10.5 18h4" />
      </>,
    ),
  },
  {
    tab: 'guess',
    label: 'Guess',
    icon: svg(
      <>
        <path d="M4 8h20v13H4z" />
        <path d="m4 8 10 8 10-8" />
      </>,
    ),
  },
  {
    tab: 'verify',
    label: 'Verify',
    icon: svg(
      <>
        <path d="M2.5 14S7 6.5 14 6.5 25.5 14 25.5 14 21 21.5 14 21.5 2.5 14 2.5 14z" />
        <circle cx="14" cy="14" r="3.6" />
      </>,
    ),
  },
];

export const MoreIcon = () =>
  svg(
    <>
      <circle cx="6" cy="14" r="1.8" />
      <circle cx="14" cy="14" r="1.8" />
      <circle cx="22" cy="14" r="1.8" />
    </>,
  );
