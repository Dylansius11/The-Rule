/** The game account the Makefile's `GAME_ACCOUNT ?=` falls back to (the r2 rehearsal). Keep in step with `Makefile`. */
export const MAKE_DEFAULT_GAME = 'game-r2.therule.testnet';

/**
 * The CLI line that replays a round outside the browser. The Makefile only knows its default game account, so
 * any other deployment (the Demo instance, a sandbox) must name its own or the command would read the wrong one.
 */
export function verifyCommand(mode: 'solo' | 'team', roundId: number, game: string): string {
  const base = `make verify ROUND=${mode}/${roundId}`;
  return game === MAKE_DEFAULT_GAME ? base : `${base} GAME_ACCOUNT=${game}`;
}
