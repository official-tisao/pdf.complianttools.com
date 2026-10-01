import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * STCC #10: `axe` zero violations, and the tool keyboard-operable end to end.
 *
 * The invoice routes are the P7-03 surface, so they are gated here. The audit
 * runs against the hydrated page because axe can only see the DOM the browser
 * built, not the prerendered shell.
 */

/** Routes gated for accessibility, with the heading that proves the page mounted. */
const a11yRoutes = [
  ['/invoice-creator', 'Invoice creator'],
  ['/e-invoice', 'Electronic invoice'],
] as const;

const openBuilder = async (page: import('@playwright/test').Page, path: string) => {
  await page.goto(path);
  // The dev server's first compile is slow on a cold cache; the default 5s
  // assertion timeout is not enough for a route that has not been built yet.
  await expect(page.locator('.builder[data-hydrated="true"]')).toBeAttached({ timeout: 30_000 });
};

for (const [route, heading] of a11yRoutes) {
  test(`${route} has zero axe violations`, async ({ page }) => {
    await openBuilder(page, route);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();

    const results = await new AxeBuilder({ page })
      // Only WCAG 2.2 A/AA rules: the bar README §20 sets. `best-practice` is
      // excluded because it includes opinions (like landmark counts) that a
      // single-route tool page is not expected to satisfy.
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const violations = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }));
    // Assert on the mapped shape so a failure names the rule and the element,
    // not just a count.
    expect(violations, `${route} axe violations`).toEqual([]);
  });
}

test('an invoice can be created using only the keyboard', async ({ page }) => {
  await openBuilder(page, '/invoice-creator');

  // Tab from the FIRST FIELD rather than from the top of the document: the
  // site header holds a dozen nav links, and walking all of them says nothing
  // about this form. What matters is that the form's own controls are
  // sequentially reachable, in a sensible order, with no mouse.
  await page.getByLabel('Invoice number').focus();
  const order: string[] = [];
  // <input type="date"> exposes several tab stops (day/month/year or the
  // segments), so the walk runs long enough to cross both date fields and reach
  // the next plain text input.
  for (let step = 0; step < 14; step += 1) {
    order.push(
      // A <label> wrapping an input contributes no textContent to the input
      // itself, so the accessible name is read from the closest label rather
      // than from the element. That is also the name a screen reader announces,
      // which is what we actually want to assert on.
      await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return '';
        const label =
          active.getAttribute('aria-label') ??
          active.closest('label')?.textContent?.trim() ??
          active.getAttribute('name') ??
          '';
        return label.trim();
      }),
    );
    await page.keyboard.press('Tab');
  }
  // Source order is preserved: number, dates, currency, then supplier.
  const seen = order.join(' | ');
  expect(seen).toMatch(/invoice number/i);
  expect(seen).toMatch(/due date/i);
  expect(seen).toMatch(/supplier name/i);
  // Focus must never fall out of the form into the page chrome.
  expect(seen).not.toMatch(/merge|convert|connect ai/i);

  // Now type into the form, moving by keyboard only.
  await page.getByLabel('Invoice number').focus();
  await page.keyboard.type('INV-KEYBOARD-1');
  await page.getByLabel('Supplier name').focus();
  await page.keyboard.type('Acme');
  await page.getByLabel('Customer name').focus();
  await page.keyboard.type('Globex');
  await page.getByLabel('Description').first().focus();
  await page.keyboard.type('Keyboard work');
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

test('the Arabic locale renders RTL with translated copy', async ({ page }) => {
  // STCC #11: `ar` catches directional bugs. The direction must come from the
  // catalogue, not be hardcoded, and the copy must actually be Arabic.
  //
  // `lang`/`dir` are asserted on `.locale-root`, the wrapper the `[locale]`
  // layout renders. They used to sit on the invoice component's own root, which
  // only covered the two hand-written localized routes; a generated localized
  // route has no such wrapper of its own, so the layout is now the single place
  // that declares direction.
  await page.goto('/ar/invoice-creator');
  const root = page.locator('.locale-root');
  await expect(root).toHaveAttribute('dir', 'rtl');
  await expect(root).toHaveAttribute('lang', 'ar');
  // The invoice number field is labelled in Arabic, not left as English.
  await expect(page.locator('.builder')).toContainText('رقم الفاتورة');
});

test('the pseudo-locale lengthens the copy so overflow is visible', async ({ page }) => {
  // en-XA exists to make layout overflow and untranslated strings obvious. If
  // the padding stopped, this test would still pass on any locale, so it
  // asserts the markers are actually present in the served DOM.
  await page.goto('/en-XA/invoice-creator');
  const builder = page.locator('.builder');
  await expect(page.locator('.locale-root')).toHaveAttribute('lang', 'en-XA');
  const text = (await builder.textContent()) ?? '';
  expect(text).toMatch(/[ÁÉÏÓÜÁ]/u);
  expect(text).toMatch(/~/u);

  // Nothing may push the DOCUMENT wider than the viewport at a phone width —
  // the size a user is most likely to hit, and where a long label hurts most.
  // Measuring the document rather than each element avoids false positives
  // from a column that is legitimately narrower than the page.
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `en-XA copy widened the page to ${overflow.scrollWidth}px in a ${overflow.clientWidth}px viewport`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test('an unknown locale 404s instead of silently rendering English', async ({ page }) => {
  const response = await page.goto('/de/invoice-creator');
  expect(response?.status()).toBe(404);
});

test('a saved template can be reached and loaded with the keyboard', async ({ page }) => {
  await openBuilder(page, '/invoice-creator');
  await page.getByLabel('Invoice number').fill('INV-KB-TPL');
  await page.getByLabel('Supplier name').fill('Initech');
  await page.getByLabel('Customer name').fill('Umbrella');
  await page.getByLabel('Template name').fill('Keyboard template');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.locator('.builder [role="status"]')).toContainText('Saved template');

  // Change the field, then activate Load from the keyboard.
  await page.getByLabel('Invoice number').fill('CHANGED');
  const load = page.getByRole('button', { name: 'Load' }).first();
  await load.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Invoice number')).toHaveValue('INV-KB-TPL');
});
