import { run } from './keeper.ts';

const { NEAR_RPC_URL, GAME_ACCOUNT, KEEPER_ACCOUNT, KEEPER_PRIVATE_KEY, HEALTHCHECK_PING_URL } = process.env;
if (!NEAR_RPC_URL || !GAME_ACCOUNT) {
  console.error('NEAR_RPC_URL and GAME_ACCOUNT are required');
  process.exitCode = 1;
} else {
  try {
    await run({ NEAR_RPC_URL, GAME_ACCOUNT, KEEPER_ACCOUNT, KEEPER_PRIVATE_KEY, HEALTHCHECK_PING_URL }, process.argv.includes('--dry-run'));
  } catch {
    process.exitCode = 1;
  }
}
