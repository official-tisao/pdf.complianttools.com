import { defineConfig, devices } from '@playwright/test';

const DEV = { command: 'pnpm exec vite dev --host 127.0.0.1 --port 4173', cwd: 'apps/web' };
const PREVIEW = { command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173', cwd: 'apps/web' };

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
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    ...(offline ? PREVIEW : DEV),
    url: 'http://127.0.0.1:4173',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
