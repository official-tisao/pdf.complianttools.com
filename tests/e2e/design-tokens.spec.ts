import { expect, test } from '@playwright/test';

test('design tokens render in light and dark themes without a blank shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Every PDF tool/i })).toBeVisible();

  const lightCanvas = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(),
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  const darkCanvas = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(),
  );

  expect(lightCanvas).not.toBe('');
  expect(darkCanvas).not.toBe('');
  expect(darkCanvas).not.toBe(lightCanvas);
  // A link, not a button: the hero CTAs navigate, and an <a> inside a <button>
  // is invalid HTML with no accessible role.
  await expect(page.getByRole('link', { name: /Start with Merge PDF/i })).toBeVisible();
});
