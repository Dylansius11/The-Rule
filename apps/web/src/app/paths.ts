import { useMatch } from 'react-router';
import type { Mode } from '@/game/types';

/** URL slug for a game mode. The chain speaks 0 and 1; people read solo and team. */
export type ModeSlug = 'solo' | 'team';

/** The pages inside a round room. `stamp` is the room's index route. */
export type RoomTab = 'stamp' | 'ledger' | 'guess' | 'verify' | 'crew';

export const slugOf = (mode: Mode): ModeSlug => (mode === 0 ? 'solo' : 'team');

/** `solo` or `team` to a mode; anything else is not a room. */
export function modeOf(slug: string | undefined): Mode | null {
  return slug === 'solo' ? 0 : slug === 'team' ? 1 : null;
}

/** Legacy `?mode=1` means Team; anything else means Solo. */
export const modeFromQuery = (raw: string | null): Mode => (raw === '1' ? 1 : 0);

/** The one place a room URL is built, so a route rename touches one file. */
export function roomPath(mode: Mode, tab: RoomTab = 'stamp', round?: number | null): string {
  const base = `/play/${slugOf(mode)}${tab === 'stamp' ? '' : `/${tab}`}`;
  return round === null || round === undefined ? base : `${base}?round=${round}`;
}

const MODE_KEY = 'the-rule:mode';

export function rememberMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, slugOf(mode));
  } catch {
    /* storage can be blocked; the switch still works for this session */
  }
}

function recalledMode(): Mode {
  try {
    return modeOf(localStorage.getItem(MODE_KEY) ?? undefined) ?? 0;
  } catch {
    return 0;
  }
}

/** The room's mode on a room URL, else the last room the player used (Solo on a first visit). */
export function useNavMode(): Mode {
  const match = useMatch('/play/:mode/*');
  return modeOf(match?.params.mode) ?? recalledMode();
}
