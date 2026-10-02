import { expect, test } from '@playwright/test';

test('extensionless and .html route spellings render the same page', async ({ page }) => {
  for (const route of ['/merge', '/merge.html', '/ai/chat-with-pdf.html']) {
    const response = await page.goto(route);
    expect(response?.ok(), route).toBeTruthy();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\.html$/);
    await expect(page.locator('body')).not.toContainText('Internal Error');
  }
});

test('visible navigation uses cache-friendly internal links', async ({ page }) => {
  await page.goto('/');

  const internalLinks = page.locator('a[href^="/"]:not([href="/"]):not([href^="/#"])');
  const count = await internalLinks.count();
  expect(count).toBeGreaterThan(10);

  for (let index = 0; index < count; index += 1) {
    await expect(internalLinks.nth(index)).toHaveAttribute('href', /\.html$/);
  }
});

test('sitemap exposes .html URLs for every prerendered page', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.ok()).toBeTruthy();
  const sitemap = await response.text();

  expect(sitemap).toContain('https://pdf.complianttools.com/merge.html');
  expect(sitemap).not.toContain('https://pdf.complianttools.com/merge</loc>');
});
