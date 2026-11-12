import { run, type Config } from './keeper.ts';

const { NEAR_RPC_URL, GAME_ACCOUNT, KEEPER_ACCOUNT, KEEPER_PRIVATE_KEY, HEALTHCHECK_PING_URL, NEAR_NETWORK, MAINTAIN_SEASONS, KEEPER_MODES, FIRST_ROUND_ID, LAST_ROUND_ID } = process.env;
if (!NEAR_RPC_URL || !GAME_ACCOUNT) {
  console.error('NEAR_RPC_URL and GAME_ACCOUNT are required');
  process.exitCode = 1;
} else {
  try {
    await run({ NEAR_RPC_URL, GAME_ACCOUNT, KEEPER_ACCOUNT, KEEPER_PRIVATE_KEY, HEALTHCHECK_PING_URL, NEAR_NETWORK: NEAR_NETWORK as Config['NEAR_NETWORK'], MAINTAIN_SEASONS, KEEPER_MODES, FIRST_ROUND_ID, LAST_ROUND_ID }, process.argv.includes('--dry-run'));
  } catch {
    process.exitCode = 1;
  }
}
