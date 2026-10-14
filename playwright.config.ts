import { defineConfig, devices } from '@playwright/test';

// Keep E2E isolated from a manually started app. Reusing a stale server can
// make every hydrated-route assertion fail at once while leaving a misleading
// "397 failed" summary. CI owns 4173; local runs use 4174 so the browser can
// keep using the app on 4173 while the test runner starts the current source.
const TEST_PORT = process.env.PLAYWRIGHT_PORT ?? (process.env.CI ? '4173' : '4174');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const DEV = {
  command: `pnpm exec vite dev --host 127.0.0.1 --port ${TEST_PORT}`,
  cwd: 'apps/web',
};
const PREVIEW = {
  command: `pnpm exec vite preview --host 127.0.0.1 --port ${TEST_PORT}`,
  cwd: 'apps/web',
};

/** `true` runs the offline suite, which needs a real service worker. */
const offline = process.env.OFFLINE === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // The offline suite asserts against the production build: a service worker is
  // only emitted by `vite build`, so the dev server would register nothing and
  // every assertion would fail for the wrong reason. OFFLINE=1 runs it against
  // a served build; the default run skips it.
  ...(offline ? {} : { testIgnore: '**/offline.spec.ts' }),
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    ...(offline ? PREVIEW : DEV),
    url: BASE_URL,
    timeout: 120_000,
    // A test run must validate the checked-out source, not whichever dev server
    // happens to be open in the developer's browser. Set this explicitly only
    // when intentionally reusing a server with matching source.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
