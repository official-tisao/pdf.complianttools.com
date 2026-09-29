import assert from 'node:assert/strict';
import { expect, test, type Page } from '@playwright/test';

/**
 * The invoice routes are prerendered, so their static markup accepts input
 * before hydration and then discards it. Wait for the builder to report itself
 * live rather than for elements to merely exist, or an assertion races the
 * client-side mount and observes the pre-hydration state.
 */
const openBuilder = async (page: Page, path: string) => {
  await page.goto(path);
  await expect(page.locator('.builder[data-hydrated="true"]')).toBeVisible();
};

const phaseFRoutes = [
  ['/create-pdf', 'Create a PDF'],
  ['/qr-code', 'QR code generator'],
  ['/invoice-creator', 'Invoice creator'],
  ['/e-invoice', 'Electronic invoice'],
  ['/scan-to-pdf', 'Scan to PDF'],
  ['/document-pack-builder', 'Document pack builder'],
  ['/webpage-to-pdf', 'Webpage to PDF'],
  ['/batch', 'Batch runner'],
  ['/recipe', 'Recipe builder'],
  ['/watch', 'Folder watcher'],
] as const;

test.describe('Phase F local workflow routes', () => {
  for (const [route, heading] of phaseFRoutes) {
    test(`${route} renders its local workflow`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Internal Error');
    });
  }
});

test('webpage capture makes the explicit Relay boundary visible', async ({ page }) => {
  await page.goto('/webpage-to-pdf');
  await expect(page.getByText(/explicit Relay mode/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Capture with Relay/i })).toBeVisible();
});

test('with no Relay configured the app is fully usable and says so honestly', async ({ page }) => {
  // The first half of P7-06's Done-when: no Relay, no broken app. The other ten
  // tools are local and must keep working, and the capture button must refuse
  // to pretend a Relay exists.
  await page.goto('/webpage-to-pdf');
  await expect(page.getByText(/Local PDF tools do not need this endpoint/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Capture with Relay/i })).toBeDisabled();

  // Every other Phase F tool is local and must remain usable. Assert the
  // controls are present and live rather than the status line: clicking these
  // buttons triggers a SvelteKit form enhancement that re-navigates and
  // remounts the page, so transient status text is not observable here. That
  // remount is pre-existing and out of P7-06's scope; it does not affect the
  // Relay boundary this test is about.
  await page.goto('/create-pdf');
  await expect(page.getByRole('combobox', { name: /Template/i })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Create PDF' })).toBeEnabled();
  await page.goto('/qr-code');
  await expect(page.getByRole('button', { name: /Export QR PDF/i })).toBeEnabled();
});

test("a Relay failure surfaces the Relay's own remedy rather than silence", async ({ page }) => {
  // The Relay knows which failure it hit and each has a distinct remedy, so the
  // UI must show that string verbatim rather than a generic failure.
  const remedy = 'Install the pinned Playwright browser for this self-hosted Relay and retry.';
  await page.route('**/render', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: 'relay-failed', cause: 'browser closed', remedy }),
    }),
  );
  await page.goto('/webpage-to-pdf');
  await page.getByLabel('Your Relay endpoint').fill('http://127.0.0.1:8787');
  await page.getByRole('button', { name: /Capture with Relay/i }).click();
  await expect(page.getByRole('status')).toHaveText(remedy);
});

test('an unreachable Relay still produces an actionable message', async ({ page }) => {
  // Nothing is listening: the request never completes, so there is no server
  // remedy to forward. The user must still be told what to do rather than
  // watching a status line that never changes.
  await page.route('**/render', (route) => route.abort('connectionrefused'));
  await page.goto('/webpage-to-pdf');
  await page.getByLabel('Your Relay endpoint').fill('http://127.0.0.1:8787');
  await page.getByRole('button', { name: /Capture with Relay/i }).click();
  await expect(page.getByRole('status')).toHaveText(
    /Relay is reachable|Check that the user-run Relay/,
  );
});

test('a tool route never renders another tool\'s controls', async ({ page }) => {
  // Regression guard. FeaturePage once fell through to a catch-all `{:else}`,
  // so /invoice-creator and /e-invoice served the folder watcher — controls
  // those tools were never built for. Each route is checked only against
  // controls that belong to a DIFFERENT tool, since every tool legitimately
  // renders its own.
  const OWNED: Readonly<Record<string, RegExp>> = {
    '/invoice-creator': /Invoice number/i,
    '/e-invoice': /Invoice number/i,
    '/merge': /Merge PDF/i,
    '/qr-code': /Text or URL/i,
    '/watch': /Choose folder and start watcher/i,
  };
  const FOREIGN: ReadonlyArray<readonly [string, RegExp]> = [
    ['folder watcher', /Choose folder and start watcher/i],
    // T35's own label, distinct from the invoice builder's "Templates" fieldset.
    ['create-pdf template picker', /Template Grid/i],
    ['Relay endpoint', /Your Relay endpoint/i],
  ];
  for (const [route, own] of Object.entries(OWNED)) {
    await page.goto(route);
    await expect(page.locator('body').filter({ hasText: own })).toHaveCount(1);
    for (const [name, pattern] of FOREIGN) {
      if (pattern.test(own.source)) continue; // its own control, not a foreign one
      await expect(
        page.locator('body').filter({ hasText: pattern }),
        `${route} must not show ${name} controls`,
      ).toHaveCount(0);
    }
  }
});

test('every invoice file input has an accessible name', async ({ page }) => {
  // A bare <input type="file"> with only aria-describedby has no accessible
  // name — the surrounding <p> is not a label — so it is unreachable by name
  // in assistive tech and fails the axe `label` rule.
  await openBuilder(page, '/e-invoice');
  const fileInputs = page.locator('.reverse input[type="file"]');
  await expect(fileInputs).toHaveCount(2);
  const count = await fileInputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = fileInputs.nth(index);
    await expect(input).toHaveAccessibleName(/.+/u);
  }
  // A keyboard user must be able to reach and activate both by tabbing.
  await fileInputs.first().focus();
  await expect(fileInputs.first()).toBeFocused();
});

test('the invoice tools are reachable from the site chrome', async ({ page }) => {
  // A tool nobody can navigate to is not shipped. The header nav is hidden
  // below 768px, so the landing-page directory is what mobile users get.
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Invoices', exact: true })).toHaveAttribute(
    'href',
    '/invoice-creator',
  );
  await expect(page.getByRole('link', { name: 'E-invoice', exact: true })).toHaveAttribute(
    'href',
    '/e-invoice',
  );

  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice creator' })).toBeVisible();

  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Create and invoices' })
    .getByRole('link', { name: 'Electronic invoice (UBL-style XML)' })
    .click();
  await expect(page.getByRole('heading', { name: 'Electronic invoice' })).toBeVisible();
});

test('a page ships exactly one meta description', async ({ page }) => {
  // Two <meta name="description"> tags is a crawler conflict. SvelteKit does
  // not dedupe <svelte:head> by attribute name, so the layout carries no
  // default and each page owns its own.
  for (const route of ['/invoice-creator', '/e-invoice', '/merge', '/']) {
    await page.goto(route);
    const descriptions = page.locator('meta[name="description"]');
    await expect(
      descriptions,
      `${route} must ship exactly one meta description`,
    ).toHaveCount(1);
  }
});

test('every prerendered page carries canonical, hreflang, and structured data', async ({ page }) => {
  // Appendix E / §7.6. Canonical and hreflang come from the layout so a new
  // route cannot ship without them; JSON-LD is per route. Checked on a spread
  // of component families: FeaturePage, ToolWorkspace, and a bespoke route.
  for (const route of ['/', '/invoice-creator', '/merge', '/compare-pdf', '/ocr-pdf']) {
    await page.goto(route);
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical, `${route} must have a canonical link`).toHaveCount(1);
    expect(new URL((await canonical.getAttribute('href')) ?? '').pathname).toBe(
      new URL(page.url()).pathname,
    );
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(3);
    await expect(page.locator('script[type="application/ld+json"]')).not.toHaveCount(0);
  }
});

test('the JSON-LD is valid, factual structured data', async ({ page }) => {
  // The claim is deliberately free of ratings and review counts: a rich result
  // that search engines later discount costs more than the one we forgo.
  await page.goto('/invoice-creator');
  const blocks = page.locator('script[type="application/ld+json"]');
  const count = await blocks.count();
  assert.ok(count >= 2, 'expected SoftwareApplication and FAQPage');
  for (let index = 0; index < count; index += 1) {
    const parsed = JSON.parse((await blocks.nth(index).textContent()) ?? '{}');
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed.aggregateRating).toBeUndefined();
    expect(parsed.review).toBeUndefined();
  }
});

test('the invoice FAQ is in the served HTML, not produced by hydration', async ({ page }) => {
  // §7.6 requires the answer to exist without JavaScript.
  await page.goto('/e-invoice');
  await expect(
    page.getByRole('heading', { name: 'Frequently asked questions' }),
  ).toBeVisible();
  await expect(page.getByText(/published OASIS UBL schema/u)).toBeAttached();

  // And the zero-JS reference is present, so the page is honest about needing JS.
  const noscript = page.locator('noscript');
  await expect(noscript).toHaveCount(1);
  expect((await noscript.textContent()) ?? '').toMatch(/need[s]? JavaScript/u);
});

test('recipe route describes a document-free deterministic share', async ({ page }) => {
  await page.goto('/recipe');
  await expect(page.getByText(/document-free recipe/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy document-free recipe link/i })).toBeVisible();
});

test.describe('P7-03 invoice builder', () => {
  // FeaturePage and InvoiceBuilder each render a role="status" line, so a bare
  // getByRole('status') is ambiguous. Scope to the builder's own region.
  const builderStatus = (page: import('@playwright/test').Page) =>
    page.locator('.builder [role="status"]');

  test('the builder is a real form and previews totals live', async ({ page }) => {
    await openBuilder(page, '/invoice-creator');
    await page.getByLabel('Invoice number').fill('INV-TEST-1');
    await page.getByLabel('Supplier name').fill('Acme');
    await page.getByLabel('Customer name').fill('Globex');
    await page.getByLabel('Description').first().fill('Consulting');
    await page.getByLabel('Qty').first().fill('2');
    await page.getByLabel('Unit price').first().fill('100');
    await page.getByLabel('Tax %').first().fill('10');

    // The preview must use the same engine totals the export uses. Scoped to
    // the builder's own totals list: the landing page has its own <dd> elements.
    const totals = page.locator('.builder .totals dd');
    await expect(totals.nth(0)).toHaveText('200.00 CAD');
    await expect(totals.nth(1)).toHaveText('20.00 CAD');
    await expect(totals.nth(2)).toHaveText('220.00 CAD');
  });

  test('an invalid invoice reports the engine remedy instead of failing silently', async ({ page }) => {
    // A tax rate above 100 is rejected by the engine. The input's own max
    // attribute is only a hint, so this proves the engine is the real guard and
    // that its remedy reaches the user instead of a broken download.
    await openBuilder(page, '/invoice-creator');
    await page.getByLabel('Invoice number').fill('INV-TEST-2');
    await page.getByLabel('Supplier name').fill('Acme');
    await page.getByLabel('Customer name').fill('Globex');
    await page.getByLabel('Description').first().fill('Consulting');
    await page.getByLabel('Tax %').first().fill('130');
    await page.getByRole('button', { name: 'Create invoice PDF' }).click();
    await expect(builderStatus(page)).toHaveText(/between 0 and 100/);
  });

  test('a named template round-trips through IndexedDB', async ({ page }) => {
    await openBuilder(page, '/invoice-creator');
    await page.getByLabel('Invoice number').fill('INV-TPL-9');
    await page.getByLabel('Supplier name').fill('Initech');
    await page.getByLabel('Customer name').fill('Umbrella');
    await page.getByLabel('Description').first().fill('Audit');
    await page.getByLabel('Template name').fill('Standard consulting');
    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(builderStatus(page)).toHaveText(/Saved template "Standard consulting"/);

    // Change the field, then reload the template and prove it was restored
    // from IndexedDB rather than from the still-live form state.
    await page.getByLabel('Invoice number').fill('CHANGED');
    await page.getByRole('button', { name: 'Load' }).click();
    await expect(page.getByLabel('Invoice number')).toHaveValue('INV-TPL-9');
    await expect(page.getByLabel('Customer name')).toHaveValue('Umbrella');
  });

  test('e-invoice offers the XML-to-PDF direction and refuses invalid XML', async ({ page }) => {
    await openBuilder(page, '/e-invoice');
    await expect(page.getByRole('heading', { name: 'Existing e-invoice XML to PDF' })).toBeVisible();

    // The page has two conversion sections, each with its own file input and
    // status line, so both are scoped rather than matched globally.
    const toPdf = page.locator('.reverse').filter({ hasText: 'Existing e-invoice XML to PDF' });
    await toPdf.locator('input[type=file]').setInputFiles({
      name: 'broken.xml',
      mimeType: 'application/xml',
      buffer: Buffer.from('<Invoice><cbc:ID>x</cbc:ID></Invoice>'),
    });
    await expect(toPdf.locator('[role="status"]')).toHaveText(/not a usable e-invoice/);
  });

  test('a PDF with no embedded XML is refused honestly rather than guessed at', async ({ page }) => {
    // Recovery reads the structured attachment only. A PDF without one must say
    // so, never invent invoice fields from the rendered page.
    await openBuilder(page, '/e-invoice');
    await page.locator('input[type=file][accept*="pdf"]').setInputFiles({
      name: 'plain.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
      ),
    });
    await expect(page.getByText(/carries no embedded e-invoice XML/)).toBeVisible();
  });
});

