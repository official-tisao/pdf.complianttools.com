import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The invoice routes are prerendered, so their static markup accepts input
 * before hydration and then discards it. Wait for the builder to report itself
 * live rather than for elements to merely exist, or an assertion races the
 * client-side mount and observes the pre-hydration state.
 */
const openBuilder = async (page: Page, path: string) => {
  await page.goto(path);
  // The dev server's first compile is slow on a cold cache; the default 5s
  // assertion timeout is not enough for a route that has not been built yet.
  await expect(page.locator('.builder[data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
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

test("a tool route never renders another tool's controls", async ({ page }) => {
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
    '/watch': /Choose folders and start watching/i,
  };
  const FOREIGN: ReadonlyArray<readonly [string, RegExp]> = [
    ['folder watcher', /Choose folders and start watching/i],
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

  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Invoices' })
    .click();
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
    await expect(descriptions, `${route} must ship exactly one meta description`).toHaveCount(1);
  }
});

test('every prerendered page carries canonical, hreflang, and structured data', async ({
  page,
}) => {
  // Appendix E / §7.6. Canonical and hreflang come from the layout so a new
  // route cannot ship without them; JSON-LD is per route. Checked on a spread
  // of component families: FeaturePage, ToolWorkspace, and a bespoke route.
  //
  // Two real locales are advertised (`en` and `ar`); `en-XA` is a CI-only
  // pseudo-locale and is deliberately not emitted. This assertion was
  // previously `toHaveCount(3)` — a count that passed while every href pointed
  // at the current page, which is how the wrong-target bug survived CI.
  for (const route of ['/', '/invoice-creator', '/merge', '/compare-pdf', '/ocr-pdf']) {
    await page.goto(route);
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical, `${route} must have a canonical link`).toHaveCount(1);
    const expectedCanonical = route === '/' ? '/' : `${route}.html`;
    expect(new URL((await canonical.getAttribute('href')) ?? '').pathname).toBe(expectedCanonical);

    const alternates = page.locator('link[rel="alternate"][hreflang]');
    await expect(alternates).toHaveCount(route === '/' ? 1 : 2);
    const hrefs = await alternates.evaluateAll((links) =>
      links.map((link) => ({
        lang: link.getAttribute('hreflang'),
        href: new URL(link.getAttribute('href') ?? '').pathname,
      })),
    );
    // Each alternate must point at its own locale's URL, not this page's.
    assertDistinctLocales(route, hrefs);
    await expect(page.locator('script[type="application/ld+json"]')).not.toHaveCount(0);
  }
});

/** Every locale must resolve to a distinct path — the bug this pins. */
function assertDistinctLocales(route: string, hrefs: Array<{ lang: string | null; href: string }>) {
  const paths = hrefs.map((entry) => entry.href);
  assert.equal(
    new Set(paths).size,
    paths.length,
    `${route}: every hreflang points at the same URL (${paths.join(', ')})`,
  );
  for (const { lang, href } of hrefs) {
    assert.ok(
      href === `/${lang}${route}.html` || href === (route === '/' ? '/' : `${route}.html`),
      `${route}: hreflang="${lang}" points at ${href}`,
    );
  }
}

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
  await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();
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

test('a shared recipe link restores the steps it was copied from', async ({ page, context }) => {
  // The share button wrote a URL fragment but nothing ever read one back, so opening a
  // shared link silently landed on the default recipe. This is the P7-08 done-when: the
  // link reproduces the recipe, with no server round-trip.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/recipe');

  // Wait for the page to be live before interacting. The step list is prerendered, so it
  // exists before hydration and an early click lands on inert markup. The editor reports
  // itself hydrated, the same signal the invoice builder uses. Retrying a mutating click
  // is not an option — a retry landing after hydration would remove a second step.
  await expect(page.locator('.recipe-editor[data-hydrated="true"]')).toBeVisible({
    timeout: 30_000,
  });
  const steps = page.locator('.recipe-steps li');
  await expect(steps).toHaveCount(1);

  // Each option is chosen once: the select keeps its value, so re-picking the same one
  // fires no new change event.
  await page.getByRole('combobox', { name: /Step/i }).selectOption({ label: 'Bates numbering' });
  await expect(steps).toHaveCount(2);
  await page.getByRole('combobox', { name: /Step/i }).selectOption({ label: 'Metadata' });
  await expect(steps).toHaveCount(3);
  await page.getByRole('combobox', { name: /Step/i }).selectOption({ label: 'Compress' });
  await expect(steps).toHaveCount(4);

  await page.getByRole('button', { name: /Copy document-free recipe link/i }).click();
  // The status line must say something either way. A denied clipboard previously rejected
  // out of the handler, so the user saw no feedback at all.
  await expect(
    page.locator('[role="status"]').filter({ hasText: /Share link|no document bytes/i }),
  ).toBeVisible();
  const link = (await page.evaluate(() => navigator.clipboard.readText())) as string;
  expect(link, 'the copied link must carry a recipe fragment').toMatch(/\/recipe#r1\./u);

  // Open it in a fresh page: a same-page reload would prove nothing about a share.
  const opened = await context.newPage();
  await opened.goto(link);
  await expect(opened.locator('.recipe-steps li')).toHaveCount(4, { timeout: 30_000 });
  await expect(
    opened.locator('[role="status"]').filter({ hasText: /Loaded a shared recipe/i }),
  ).toBeVisible();
  await opened.close();
});

test('a corrupt recipe fragment is reported, not thrown away silently', async ({ page }) => {
  // A link can be truncated by a chat client or an editor. It must say so rather than
  // leaving the user looking at a default recipe that is not what they were sent.
  await page.goto('/recipe#r1.not-a-real-fragment');
  await expect(
    page.locator('[role="status"]').filter({ hasText: /could not be read/i }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Copy document-free recipe link/i })).toBeVisible();
});

test('a saved recipe is restored on reload, not discarded', async ({ page }) => {
  // The IndexedDB save had no reader anywhere in the app, so the recipe was written on Share
  // and never read back — a reload silently returned the default. README §4.10 T70 asks for a
  // save that persists.
  await page.goto('/recipe');
  await expect(page.locator('.recipe-editor[data-hydrated="true"]')).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: /Save to this browser/i }).click();
  await expect(
    page.locator('[role="status"]').filter({ hasText: /Saved to this browser/i }),
  ).toBeVisible();

  // The default recipe has one step. Removing it, then reloading, is the only way to tell a
  // restored recipe from a fresh default.
  await page.getByRole('button', { name: /Remove step 1/i }).click();
  await expect(page.locator('.recipe-steps li')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.recipe-editor[data-hydrated="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('[role="status"]').filter({ hasText: /Restored your last recipe/i }),
  ).toBeVisible({ timeout: 30_000 });
});

test('the recipe route offers the export T70 requires', async ({ page }) => {
  await page.goto('/recipe');
  await expect(page.getByRole('button', { name: /Export JSON/i })).toBeVisible();
});

test('add-image separates the base PDF and image upload steps', async ({ page }) => {
  await page.goto('/add-image');
  await expect(page.locator('section[data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });

  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(2);
  await expect(inputs.nth(0)).toHaveAttribute('accept', '.pdf,application/pdf');
  await expect(inputs.nth(1)).toHaveAttribute('accept', '.png,.jpg,.jpeg,image/png,image/jpeg');

  await inputs.nth(0).setInputFiles('fixtures/pdfs/one-page.pdf');
  await expect(page.getByRole('status')).toContainText(/Choose the image in step 2/i);
  await page.getByRole('button', { name: /Run locally/i }).click();
  await expect(page.getByRole('alert')).toContainText(/image in step 2/i);

  await inputs.nth(1).setInputFiles('fixtures/p7-04/skew-upright.png');
  await expect(page.getByRole('status')).toContainText(/Base PDF and image selected/i);
});

test.describe('P7-07 batch runner', () => {
  const selectPdfs = async (page: import('@playwright/test').Page, count: number) => {
    await page.goto('/batch');
    // The route is prerendered, so its markup accepts a file and then throws it away. This is
    // silent: the input keeps its file and Playwright reports no error, but the component's own
    // `files` is empty, so the Run button stays disabled and the failure surfaces 30 seconds
    // later as an inexplicable timeout. Nothing on this route publishes a hydration signal, so
    // the gate is the observable consequence of hydration — the live component reacting to input.
    // Refilling is safe to retry here: `setInputFiles` replaces the selection wholesale, so a
    // second attempt cannot leave an extra file behind.
    const payload = Array.from({ length: count }, (_, index) => ({
      name: `doc-${index + 1}.pdf`,
      mimeType: 'application/pdf',
      buffer: readFileSync(join(process.cwd(), 'fixtures', 'pdfs', 'one-page.pdf')),
    }));
    const runButton = page.getByRole('button', { name: /Run local batch/i });
    // Real PDFs, not stubs: the engine inspects each one before running the recipe, and a stub
    // would fail classification rather than exercising the per-file status path.
    await expect(async () => {
      await page.locator('input[type="file"]').setInputFiles(payload);
      await expect(runButton).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
  };

  test('each file gets its own status row naming it', async ({ page }) => {
    // README §11.5 asks for per-file status rows. The page previously showed one aggregate
    // count, so a user could not tell which file had failed or why.
    await selectPdfs(page, 3);
    await page.getByRole('button', { name: /Run local batch/i }).click();

    const rows = page.locator('[data-testid="batch-rows"] li');
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    await expect(rows.first()).toHaveAttribute('data-status', 'succeeded');
    await expect(page.getByText('doc-1.pdf')).toBeVisible();
    await expect(page.getByText('doc-3.pdf')).toBeVisible();
  });

  test('completed results are downloadable', async ({ page }) => {
    await selectPdfs(page, 2);
    await page.getByRole('button', { name: /Run local batch/i }).click();
    await expect(page.locator('[data-testid="batch-rows"] li')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Download results as ZIP/i })).toBeVisible();
  });

  test('a retry control appears only when something failed', async ({ page }) => {
    await selectPdfs(page, 1);
    // Before a run there is nothing to retry, so the control must not be offered.
    await expect(page.getByRole('button', { name: /Retry failed only/i })).toHaveCount(0);
    await page.getByRole('button', { name: /Run local batch/i }).click();
    await expect(page.locator('[data-testid="batch-rows"] li')).toHaveCount(1, { timeout: 30_000 });
    // All succeeded, so there is still nothing to retry.
    await expect(page.getByRole('button', { name: /Retry failed only/i })).toHaveCount(0);
  });
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

  test('an invalid invoice reports the engine remedy instead of failing silently', async ({
    page,
  }) => {
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
    await expect(
      page.getByRole('heading', { name: 'Existing e-invoice XML to PDF' }),
    ).toBeVisible();

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

  test('a PDF with no embedded XML is refused honestly rather than guessed at', async ({
    page,
  }) => {
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
test.describe('P7-04 scan capture', () => {
  const status = (page: import('@playwright/test').Page) => page.getByRole('status').first();

  /**
   * Clicks a control and waits for the status line to change, retrying the click
   * until it takes.
   *
   * SvelteKit serves this route with its static HTML before hydration finishes,
   * so a click dispatched in that window hits inert markup and is silently
   * dropped — the assertion then times out against an empty status line for a
   * reason that has nothing to do with the code under test. There is no
   * hydration marker in the DOM to wait on, so the observable effect is the
   * signal: keep clicking until the page reacts. This is deterministic with
   * respect to hydration, unlike a fixed sleep.
   */
  const clickAndExpectStatus = async (
    page: import('@playwright/test').Page,
    name: string | RegExp,
    expected: RegExp,
  ) => {
    const line = status(page);
    await expect(async () => {
      await page.getByRole('button', { name }).click();
      await expect(line).toHaveText(expected);
    }).toPass({ timeout: 10_000 });
  };

  test('the camera is never requested without an explicit gesture', async ({ page }) => {
    // The core of P7-04's permission seam: loading the route must not call
    // getUserMedia. A page that asked on load would prompt before the user ever
    // asked to scan anything, which is what this project forbids.
    await page.addInitScript(() => {
      (window as unknown as { __cameraRequested: number }).__cameraRequested = 0;
      const media = navigator.mediaDevices;
      if (!media) return;
      const original = media.getUserMedia.bind(media);
      media.getUserMedia = (constraints: MediaStreamConstraints) => {
        (window as unknown as { __cameraRequested: number }).__cameraRequested += 1;
        return original(constraints);
      };
    });

    await page.goto('/scan-to-pdf');
    await expect(page.getByRole('heading', { name: 'Scan to PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __cameraRequested: number }).__cameraRequested,
      ),
    ).toBe(0);
  });

  test('a denied camera permission surfaces the engine remedy', async ({ page }) => {
    // requestScanCamera maps a rejected getUserMedia to permission-denied. The
    // remedy, not a generic failure, must reach the status line.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        // A real DOMException carries the code in `name`; that is what the
        // engine branches on, so the stub has to match or it tests the
        // unrecognised path instead of the permission one.
        value: {
          getUserMedia: () => {
            const error = new Error('Permission denied');
            error.name = 'NotAllowedError';
            return Promise.reject(error);
          },
        },
      });
    });
    await page.goto('/scan-to-pdf');
    await clickAndExpectStatus(page, 'Start camera', /Allow camera access in the browser/);
  });

  test('a device with no camera is not told to grant permission', async ({ page }) => {
    // Asking someone to allow a camera that does not exist sends them somewhere
    // they cannot succeed, so this must read differently from a denial.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () => {
            const error = new Error('Requested device not found');
            error.name = 'NotFoundError';
            return Promise.reject(error);
          },
        },
      });
    });
    await page.goto('/scan-to-pdf');
    await clickAndExpectStatus(page, 'Start camera', /No camera was found on this device/);
  });

  test('a runtime with no camera support says so instead of failing silently', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    });
    await page.goto('/scan-to-pdf');
    await clickAndExpectStatus(page, 'Start camera', /getUserMedia support/);
  });

  test('the file-input path still assembles a PDF without a camera', async ({ page }) => {
    // §7.6 requires a real file input in served HTML, and the imported-image
    // path must keep working with no camera and no JavaScript-only affordance.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.goto('/scan-to-pdf');
    const input = page.locator('input[type=file]');
    // The `change` handler is a hydration-time binding, so the files are set
    // again on each attempt until the button actually enables.
    await expect(async () => {
      await input.setInputFiles([
        { name: 'page-1.png', mimeType: 'image/png', buffer: png },
        { name: 'page-2.png', mimeType: 'image/png', buffer: png },
      ]);
      await expect(page.getByRole('button', { name: 'Assemble scan to PDF' })).toBeEnabled();
    }).toPass({ timeout: 10_000 });

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Assemble scan to PDF' }).click();
    await download;
    await expect(status(page)).toHaveText(/Assembled 2 pages locally/);
  });

  test('assembling is disabled until there is a page to assemble', async ({ page }) => {
    await page.goto('/scan-to-pdf');
    await expect(page.getByRole('button', { name: 'Assemble scan to PDF' })).toBeDisabled();
  });
});
