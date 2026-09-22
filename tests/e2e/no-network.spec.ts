import { expect, test } from '@playwright/test';

test('local landing page has a real file input and no third-party requests', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:4173')) externalRequests.push(url);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Every PDF tool. In your browser.' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  expect(externalRequests).toEqual([]);
});

test('the landing page remains readable and selectable with JavaScript disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Every PDF tool. In your browser.' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await context.close();
});
