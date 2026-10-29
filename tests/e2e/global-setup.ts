import { chromium } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';

/**
 * Warms the dev server before any worker navigates.
 *
 * `fullyParallel` fans every spec out to half the machine's cores at once, and
 * on a cold vite cache that herd is a thundering-herd compile storm: 16 workers
 * request 16 route graphs together, vite cannot transform them concurrently
 * (dynamic imports fail while dependencies re-bundle), SvelteKit never mounts,
 * and every `body[data-hydrated="true"]` wait in `helpers.ts` misses its 30s
 * budget. Measured on this repo with a cleared cache: 16 workers fail 10 route
 * audits, 8 fail 8, 4 pass all 157 — the failure is parallel cold-compile, not
 * the pages themselves. The CI `accessibility` job is hit hardest of all: it
 * starts a fresh cold dev server once per shard step, on a 2-core runner.
 *
 * The fix is to pay the shared compile cost once, serially, before the workers
 * spawn: one warm page load compiles the Svelte/SvelteKit runtime, the layout,
 * the tool directory and the fonts that every other route reuses, so a
 * worker's first navigation to its own route only adds one small page module.
 *
 * The routes below cover the three page archetypes in `src/routes`, because
 * each mounts a different shell on top of the shared graph: the landing page
 * (layout + tool directory), a `ConversionTool` route (its `{@html}` fallback),
 * and an `AiDocumentTool` route. If any of them cannot hydrate, everything
 * downstream fails anyway, so a warm-up failure aborts the run loudly instead
 * of masking as a slow suite.
 */
const WARM_ROUTES = ['/', '/compress-pdf', '/ai/chat-with-pdf'] as const;

/** A cold compile of the shared graph is exactly what this exists to absorb. */
const WARM_TIMEOUT = 60_000;

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of WARM_ROUTES) {
      await page.goto(new URL(path, BASE_URL).href, { timeout: WARM_TIMEOUT });
      await page.locator('body[data-hydrated="true"]').waitFor({ timeout: WARM_TIMEOUT });
    }
    await page.close();
  } finally {
    await browser.close();
  }
}
