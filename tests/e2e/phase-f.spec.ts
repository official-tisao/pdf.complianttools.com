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

test('recipe route describes a document-free deterministic share', async ({ page }) => {
  await page.goto('/recipe');
  await expect(page.getByText(/document-free recipe/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy document-free recipe link/i })).toBeVisible();
});
