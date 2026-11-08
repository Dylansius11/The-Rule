import { useOutletContext } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ModeSlug } from '@/app/paths';
import type { Mode, Round } from '@/game/types';

/** What the room hands to its tab: which mode this room is and the mode's newest round. */
export interface Room {
  mode: Mode;
  slug: ModeSlug;
  /** The newest round of this mode. Stamp and Guess always act on this one. */
  latest: UseQueryResult<Round | null | undefined>;
}

export const useRoom = (): Room => useOutletContext<Room>();
