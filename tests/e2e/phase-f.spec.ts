import { expect, test } from '@playwright/test';

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

  // The route is prerendered, so its static markup accepts input before
  // hydration and then discards it. Wait for the builder to report itself live
  // rather than for elements to merely exist, or every assertion below races
  // the client-side mount and observes the pre-hydration state.
  const openBuilder = async (page: import('@playwright/test').Page, path: string) => {
    await page.goto(path);
    await expect(page.locator('.builder[data-hydrated="true"]')).toBeVisible();
  };

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

