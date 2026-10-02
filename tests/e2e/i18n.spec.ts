import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * STCC #11: every user-visible string is an i18n message, and the UI survives
 * `en-XA` (pseudo-locale) and `ar` (RTL).
 *
 * The previous gate for this was `scripts/i18n.test.mjs`, which read the
 * catalogue *source* with regexes and asserted on patterns rather than on
 * rendered output. It could not have caught either failure it existed to
 * prevent:
 *
 *   - `translate()` falls back to the English source for a missing key, so a
 *     route with zero translations still renders — and "both pseudo-locale
 *     passes are green" would hold.
 *   - `pseudo()` is applied to the *fallback*, so a hardcoded English literal
 *     in a template is never accented or padded. `en-XA` therefore could not
 *     detect the one thing README §21 says it exists to catch.
 *
 * These assertions run against a real build, per route, per locale.
 */

// Read synchronously from the repo root: Playwright transpiles this file, so a
// top-level `await import` and `import.meta` are both unavailable.
const manifest = JSON.parse(readFileSync('docs/route-manifest.json', 'utf8')) as {
  routes: Array<{ path: string; shell: string }>;
};

/** The four page shells that resolve their copy through the catalogue. */
const LOCALIZABLE_SHELLS = new Set([
  'ToolWorkspace',
  'PhaseCTool',
  'ConversionTool',
  'FeaturePage',
]);
const localized = manifest.routes.filter((route) => LOCALIZABLE_SHELLS.has(route.shell));

const staticPath = (path: string): string => (path === '/' ? '/' : `${path}.html`);

test.describe('every localizable route is served in all three locales', () => {
  for (const { path } of localized) {
    test(`${path} has /en, /en-XA and /ar variants`, async ({ page }) => {
      for (const locale of ['en', 'en-XA', 'ar']) {
        const response = await page.goto(`/${locale}${path}`);
        expect(response?.status(), `/${locale}${path} should resolve`).toBe(200);
      }
    });
  }
});

test('an Arabic page renders translated copy, not English', async ({ page }) => {
  await page.goto('/ar/crop-pdf');
  // The action label comes from the catalogue. If it renders as English, the
  // shell fell through to the fallback and the translation is missing.
  await expect(page.getByRole('button', { name: 'قص الصفحات' })).toBeVisible();
});

test('an Arabic page is marked RTL and declares its language', async ({ page }) => {
  await page.goto('/ar/crop-pdf');
  const root = page.locator('.locale-root');
  await expect(root).toHaveAttribute('dir', 'rtl');
  await expect(root).toHaveAttribute('lang', 'ar');
});

test('the pseudo-locale accents and pads the copy it renders', async ({ page }) => {
  await page.goto('/en-XA/crop-pdf');
  const body = page.locator('body');
  const text = (await body.textContent()) ?? '';
  // en-XA exists to make overflow and untranslated strings obvious. If the
  // padding stopped, this would still pass on any locale.
  expect(text, 'en-XA must accent Latin letters').toMatch(/[ÁÉÏÓÜÁ]/u);
  expect(text, 'en-XA must pad so overflow shows').toMatch(/~/u);
});

test('the pseudo-locale causes no horizontal overflow at a phone width', async ({ page }) => {
  await page.goto('/en-XA/crop-pdf');
  // 390px is the width a phone user hits most, and where a padded label hurts.
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));
  expect(
    box.scrollWidth,
    `en-XA widened the page to ${box.scrollWidth}px in a ${box.clientWidth}px viewport`,
  ).toBeLessThanOrEqual(box.clientWidth + 1);
});

test.describe('every localized page advertises correct hreflang alternates', () => {
  // One test per route rather than a loop inside a single test: 60 sequential
  // navigations in one test exceeded Playwright's 30s timeout once every page
  // also rendered the tool directory. Splitting keeps each assertion
  // individually reported instead of failing as one opaque timeout.
  for (const { path } of localized) {
    test(`${path} points each alternate at its own locale`, async ({ page }) => {
      await page.goto(`/ar${path}`);
      const hrefs = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) =>
        links.map((link) => ({
          lang: link.getAttribute('hreflang'),
          href: new URL(link.getAttribute('href') ?? '').pathname,
        })),
      );
      const byLang = Object.fromEntries(hrefs.map((entry) => [entry.lang, entry.href]));
      expect(byLang.en, `${path}: hreflang=en must point at the English URL`).toBe(
        staticPath(path),
      );
      expect(byLang.ar, `${path}: hreflang=ar must point at the Arabic URL`).toBe(
        staticPath(`/ar${path}`),
      );
    });
  }
});

test('an unknown locale 404s rather than silently rendering English', async ({ page }) => {
  const response = await page.goto('/de/crop-pdf');
  expect(response?.status()).toBe(404);
});

test('an English route still renders unprefixed', async ({ page }) => {
  await page.goto('/crop-pdf');
  await expect(page.getByRole('heading', { level: 1, name: 'Crop PDF' })).toBeVisible();
});
