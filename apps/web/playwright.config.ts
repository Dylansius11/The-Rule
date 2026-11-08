import { defineConfig } from '@playwright/test';

/** E2E_PORT lets a second checkout run beside the main dev server without reusing it. */
const port = Number(process.env.E2E_PORT ?? 5173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 45_000 },
  retries: 0,
  use: {
    baseURL: origin,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
