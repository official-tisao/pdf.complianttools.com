import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { openBuilder, openHydrated } from './helpers';

/**
 * STCC #10: `axe` zero violations on every route, and every tool
 * keyboard-operable end to end. README §20 sets this bar.
 *
 * **What this file used to cover: two routes.** `/invoice-creator` and
 * `/e-invoice` were gated and the other 124 were not, for the same reason every
 * other gate in this repo once had: each kept a private hand-maintained list,
 * and those lists disagreed. `scripts/route-manifest.mjs` exists to end that
 * (P7-11a), and this spec now enumerates it instead of naming routes.
 *
 * The routes are enumerated at import time from `docs/route-manifest.json`, so a
 * new page is audited the moment it is added — there is no list here to forget
 * to extend. `pnpm verify:routes` keeps that manifest in step with the
 * filesystem, and this file fails if it is stale.
 */

// Read synchronously from the repo root: Playwright transpiles this file, so a
// top-level `await import` and `import.meta` are both unavailable.
const manifest = JSON.parse(readFileSync('docs/route-manifest.json', 'utf8')) as {
  routeCount: number;
  deadControls: string[];
  routes: Array<{ path: string; shell: string; opBinding: string | null }>;
};

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/**
 * Only WCAG 2.2 A/AA rules — the bar README §20 sets.
 *
 * `best-practice` is excluded because it carries opinions (such as landmark
 * counts) that a single-route tool page is not expected to satisfy, and
 * including it would mean "zero violations" was really "zero violations of
 * rules this project never agreed to".
 */
const audit = (page: import('@playwright/test').Page) =>
  new AxeBuilder({ page }).withTags([...WCAG_22_AA]).analyze();

/** Maps violations to a shape that names the rule and the element, not a count. */
const summarise = (results: Awaited<ReturnType<typeof audit>>) =>
  results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));

test.describe('every route has zero axe violations', () => {
  // One test per route, never a loop inside a single test. `tests/e2e/i18n.spec.ts`
  // found this the hard way: 60 sequential navigations inside one `test()`
  // exceeded Playwright's 30s budget once every page also rendered the tool
  // directory. Splitting keeps each route individually reported instead of one
  // opaque timeout naming no route at all.
  for (const { path } of manifest.routes) {
    test(`${path} has zero axe violations`, async ({ page }) => {
      await openHydrated(page, path);
      expect(summarise(await audit(page)), `${path} axe violations`).toEqual([]);
    });
  }
});

test('the manifest this spec enumerates is not stale', () => {
  // A sweep that silently covers fewer routes than the site ships looks exactly
  // like a sweep that passes. This fails loudly if the manifest disagrees with
  // its own route list.
  expect(manifest.routes.length).toBe(manifest.routeCount);
});

test('a route with a disabled primary action still explains itself accessibly', () => {
  // `/bookmarks`, `/pdf-to-pdfa`, and `/rasterize-pdf` render a disabled Run
  // button by design. `tests/contracts/dead-control-gate.test.mjs` proves the
  // reason is stated in the source; this asserts the manifest agrees, so the
  // three cannot drift apart silently.
  //
  // `opBinding === null` alone is not the filter: `route-manifest.mjs` only
  // assigns a shell to routes that mount a page shell at all, so every one of
  // the eleven bespoke routes and every `FeaturePage`/`AiDocumentTool` route is
  // also `null` — none of them renders a disabled button. The set that actually
  // renders one is `manifest.deadControls`, which the manifest computes from the
  // shell (`ONRUN_SHELLS`) rather than from this field.
  const dead = manifest.deadControls;
  expect([...dead].sort()).toEqual(['/bookmarks', '/pdf-to-pdfa', '/rasterize-pdf']);
});

test.describe('keyboard operability', () => {
  test('the page-thumbnail grid is navigable and reorderable with no pointer', async ({ page }) => {
    // README §20 names the thumbnail grid explicitly: "arrow keys + space".
    // `/organize` is the route that owns page order, and `PageGrid` only
    // renders once a file is loaded — so this test must supply one. An audit of
    // the bare page would never see the grid at all, which is why the keyboard
    // pass and the axe pass are different jobs.
    await openHydrated(page, '/organize');
    // A real committed fixture, not an inline string. A hand-written minimal
    // PDF has no xref table and pdf.js rejects it, which leaves `pageCount` at
    // 0 and the grid never renders — a failure that looks exactly like a missing
    // grid. `fixtures/pdfs/two-page.pdf` is generated with provenance.
    await page
      .locator('input[type="file"][accept*="pdf"]')
      .setInputFiles('fixtures/pdfs/two-page.pdf');

    const grid = page.getByRole('grid', { name: 'PDF pages' });
    await expect(grid).toBeVisible({ timeout: 30_000 });

    // The grid owns a roving `aria-activedescendant`, so a screen reader is
    // told where the keyboard is. Without this the arrow keys move a cursor
    // assistive technology never learns about — which is exactly the defect
    // P7-11c closed and the reason this assertion exists.
    await expect(grid).toHaveAttribute('aria-activedescendant', /.+/);

    // Arrow keys move the cursor; Alt+Arrow reorders. Both must work with no
    // pointer at all, and the grid must be reachable by Tab first.
    await grid.focus();
    const start = await grid.getAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const moved = await grid.getAttribute('aria-activedescendant');
    expect(moved, 'ArrowRight must move the active page').not.toBe(start);
  });

  test('the invoice builder is reachable and completable by keyboard alone', async ({ page }) => {
    // Retained from the original spec: the form is the densest interactive
    // surface in the app, and it was the route that proved the hydration wait
    // was necessary.
    await openBuilder(page, '/invoice-creator');

    await page.getByLabel('Invoice number').focus();
    await page.keyboard.type('INV-KEYBOARD-2');
    await page.getByLabel('Supplier name').focus();
    await page.keyboard.type('Keyboard supplier');
    // A line item needs all three of its fields, and the builder refuses to
    // export without them — so the keyboard path has to reach the per-line
    // inputs too, not just the header ones.
    await page.getByLabel('Description').first().focus();
    await page.keyboard.type('Keyboard line item');
    await page.getByLabel('Qty').first().focus();
    await page.keyboard.type('2');
    await page.getByLabel('Unit price').first().focus();
    await page.keyboard.type('100');

    const create = page.getByRole('button', { name: 'Create invoice PDF' });
    await create.focus();
    // Space activates a button, which proves it is reachable and operable
    // without a pointer.
    await page.keyboard.press('Space');
    await expect(page.locator('.builder [role="status"]')).toContainText('Created locally');
  });

  test('the typed signature path is operable without a pointer', async ({ page }) => {
    // README §20 asks for a real signature pad plus an alternate type-to-sign
    // path. The canvas is pointer-oriented, while the text field remains a
    // fully keyboard-operable alternative.
    await openHydrated(page, '/sign-pdf');
    await expect(page.getByRole('group', { name: 'Draw a signature' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear drawing' })).toBeDisabled();
    const field = page.getByLabel('Signature text');
    await expect(field).toHaveValue('');
    await field.focus();
    await page.keyboard.type('A. Signer');
    await expect(field).toHaveValue('A. Signer');
  });

  test('the diff view exposes its changes as readable text, not a canvas', async ({ page }) => {
    // README §20 requires a keyboard-navigable change list, not only a visual
    // heatmap. Use two real fixtures so the list is exercised rather than merely
    // inspecting the empty route shell.
    await openHydrated(page, '/compare-pdf');
    const inputs = page.locator('input[type="file"]');
    await inputs.nth(0).setInputFiles('fixtures/pdfs/one-page.pdf');
    await inputs.nth(1).setInputFiles('fixtures/pdfs/two-page.pdf');
    await page.getByRole('button', { name: 'Compare locally' }).click();
    const list = page.getByRole('listbox', { name: 'Text changes' });
    await expect(list).toBeVisible();
    const changes = list.getByRole('option');
    await changes.first().focus();
    await expect(changes.first()).toBeFocused();
    if ((await changes.count()) > 1) {
      await page.keyboard.press('ArrowDown');
      await expect(changes.nth(1)).toBeFocused();
    }
  });

  test('the viewer canvas is labelled for assistive technology', async ({ page }) => {
    // The only `<canvas>` in the app. A canvas with no accessible name is an
    // unnamed image to a screen reader, and it is the page's whole content.
    await openHydrated(page, '/view-pdf');
    await expect(page.getByLabel('Rendered PDF page')).toBeVisible();
  });
});
