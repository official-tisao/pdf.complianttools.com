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

test('AI local fallback does not issue a request and cannot prepare without a file', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) externalRequests.push(request.url());
  });
  await page.goto('/ai/summarize');
  await expect(page.getByRole('heading', { name: 'Summarize, quiz, flashcards, and mind map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run locally first' })).toBeDisabled();
  await expect(page.getByText('No provider is configured').first()).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test('Connect AI teaches provider-neutral setup without exposing a key in the URL', async ({ page }) => {
  await page.goto('/connect-ai');
  await expect(page.getByRole('heading', { name: 'Connect your AI' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'OpenAI-compatible' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Anthropic-compatible' })).toBeVisible();
  await expect(page).toHaveURL(/\/connect-ai$/u);
});
