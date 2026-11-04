import { run, type Config } from './keeper.ts';

export default {
  async scheduled(_event: unknown, env: Config): Promise<void> {
    await run(env);
  },
};
