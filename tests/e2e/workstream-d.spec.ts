import { expect, test } from '@playwright/test';

test('Workstream D routes expose local file controls and honest capability copy', async ({ page }) => {
  for (const route of ['/view-pdf', '/compare-pdf', '/pdf-metadata', '/pdf-inspector', '/ocr-pdf']) {
    await page.goto(route);
    await expect(page.locator('input[type="file"]')).toHaveCount(route === '/compare-pdf' ? 2 : 1);
    await expect(page.getByText(/locally|local/i).first()).toBeVisible();
  }
});

test('viewer and compare route shells make no external requests', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) externalRequests.push(request.url());
  });
  await page.goto('/view-pdf');
  await expect(page.getByRole('heading', { name: 'PDF viewer' })).toBeVisible();
  await page.goto('/compare-pdf');
  await expect(page.getByRole('heading', { name: 'Compare PDFs' })).toBeVisible();
  expect(externalRequests).toEqual([]);
});
