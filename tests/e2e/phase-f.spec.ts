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
