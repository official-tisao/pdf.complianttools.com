import { expect, test } from '@playwright/test';

/**
 * STCC #12: the tool works offline, or states its reason honestly.
 *
 * These run against the production build, because a service worker is only
 * emitted by `vite build` — the dev server serves a different module graph and
 * registers nothing, so every assertion would fail for the wrong reason. Run
 * them with `OFFLINE=1 pnpm test:e2e`; the default run skips this file.
 */

/**
 * Resolves once the service worker has finished precaching, and returns the
 * cached paths.
 *
 * The precache fills entry by entry (measured: 7 → 58 → 173 entries) and the
 * worker activates partway through, so waiting for "a non-empty cache" resolves
 * against a half-populated store. The test waits for the count to stop growing
 * instead, which is what "install finished" actually means.
 */
const waitForPrecache = async (page: import('@playwright/test').Page): Promise<string[]> => {
  const deadline = Date.now() + 60_000;
  let previous = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const count = await page.evaluate(async () => {
      const names = await caches.keys();
      if (names.length === 0) return 0;
      return (await (await caches.open(names[0])).keys()).length;
    });
    // Two consecutive identical counts mean the install has settled.
    stable = count === previous ? stable + 1 : 0;
    if (stable >= 2 && count > 0) {
      return page.evaluate(async () => {
        const names = await caches.keys();
        const store = await caches.open(names[0]);
        return (await store.keys()).map((request) => new URL(request.url).pathname);
      });
    }
    previous = count;
    await page.waitForTimeout(500);
  }
  throw new Error('the service worker never finished precaching');
};

test.describe('offline support', () => {
  // These must not run in parallel with each other. They share one origin and
  // one service worker, and two of them call `setOffline(true)`, so a
  // concurrent run has the offline test tearing the network down underneath the
  // one that is still waiting for its precache.
  test.describe.configure({ mode: 'serial' });

  test('the service worker precaches the invoice routes but not the heavy runtimes', async ({
    page,
  }) => {
    await page.goto('/invoice-creator', { waitUntil: 'load' });
    // Wait for the install to FINISH rather than reading a store that is still
    // filling. The precache is written concurrently (measured: 7 → 58 → 173
    // entries) and the worker activates partway through, so "the page is
    // present" resolves well before the rest has landed.
    const settled = await waitForPrecache(page);

    expect(settled.length, 'the service worker cached almost nothing').toBeGreaterThan(100);
    expect(settled, 'the invoice page is not available offline').toContain('/invoice-creator');
    // pdfium (4.4 MB) and the pdf.js worker (2.1 MB) must stay out of the
    // precache: a first visit should not download 6.5 MB it never uses.
    expect(
      settled.filter((key) => key.endsWith('.wasm') || key.includes('pdf.worker')),
      'the heavy runtimes are precached',
    ).toEqual([]);
  });

  test('a visited tool loads with the network switched off', async ({ page, context }) => {
    await page.goto('/invoice-creator', { waitUntil: 'load' });
    await waitForPrecache(page);

    await context.setOffline(true);
    await page.goto('/invoice-creator', { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: 'Invoice creator' })).toBeVisible();
    // The form is a local component: it must mount from cache, not merely
    // render the prerendered shell.
    await expect(page.locator('.builder')).toHaveCount(1);
  });

  test('an unvisited page falls back honestly rather than failing blank', async ({
    page,
    context,
  }) => {
    await page.goto('/invoice-creator', { waitUntil: 'load' });
    await waitForPrecache(page);

    // A page that was never precached and never fetched.
    await context.setOffline(true);
    await page.goto('/definitely-not-a-real-tool', { waitUntil: 'load' }).catch(() => undefined);
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).toMatch(/not been saved|offline/i);
  });
});
