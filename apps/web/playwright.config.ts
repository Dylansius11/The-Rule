import { defineConfig } from '@playwright/test';

const sandbox = process.env.E2E_SANDBOX === '1';
/** E2E_PORT lets a second checkout run beside the main dev server without reusing it. */
const port = Number(process.env.E2E_PORT ?? 5173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 45_000 },
  retries: 0,
  ...(sandbox ? { globalSetup: './e2e/support/global-setup.ts', workers: 1 } : {}),
  use: {
    baseURL: origin,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: '**/sandbox/**', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      testIgnore: '**/sandbox/**',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    ...(sandbox
      ? [
          {
            name: 'sandbox',
            testMatch: '**/sandbox/*.spec.ts',
            use: { viewport: { width: 1280, height: 800 } },
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm exec vite ${sandbox ? '--mode e2e ' : ''}--host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !sandbox,
    timeout: 120_000,
  },
});
