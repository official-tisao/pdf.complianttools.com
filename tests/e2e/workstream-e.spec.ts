import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = resolve('fixtures/pdfs/one-page.pdf');

async function waitForHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => document.documentElement.dataset.appHydrated === 'true');
}

test('escalation host controls are disabled until the local result exists', async ({ page }) => {
  const hosts = [
    ['/pdf-to-markdown', 'T29'],
    ['/create-form', 'T44'],
    ['/pdf-accessibility', 'T52'],
    ['/redact-pdf', 'T59'],
  ] as const;

  for (const [route, tool] of hosts) {
    await page.goto(route);
    await waitForHydration(page);
    await expect(page.getByRole('button', { name: `Prepare ${tool} request` })).toBeDisabled();
  }

  await page.goto('/compare-pdf');
  await waitForHydration(page);
  await expect(page.getByRole('heading', { name: 'Compare PDFs' })).toBeVisible();
  await expect(page.getByText(/Local difference report/i)).toBeVisible();
});

test('T29 local extraction unlocks the optional action without making a provider request', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) externalRequests.push(request.url());
  });

  await page.goto('/pdf-to-markdown');
  await waitForHydration(page);
  const escalation = page.getByRole('button', { name: 'Prepare T29 request' });
  await expect(escalation).toBeDisabled();
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Extract locally' }).click();
  await expect(page.getByText(/Local extraction complete/i)).toBeVisible({ timeout: 30_000 });
  await expect(escalation).toBeEnabled();

  await escalation.click();
  await expect(page.getByText(/No provider is configured.*no AI request was made/i)).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('the semantic-diff escalation appears only after local comparison output', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/compare-pdf');
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: 'Prepare T61 request' })).toHaveCount(0);
  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).setInputFiles(fixture);
  await inputs.nth(1).setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Compare locally' })).toBeEnabled();
  await page.getByRole('button', { name: 'Compare locally' }).click();
  await expect(page.getByText(/No text changes found/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Prepare T61 request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare T61 request' })).toBeEnabled();
});

test('C and D host escalations unlock only after their local result', async ({ page }) => {
  test.setTimeout(90_000);
  const hosts = [
    ['/create-form', 'T44', /AcroForm fields created locally/i],
    ['/pdf-accessibility', 'T52', /Accessibility audit complete/i],
    ['/redact-pdf', 'T59', /Redaction exported only after verification/i],
  ] as const;

  for (const [route, tool, localStatus] of hosts) {
    await page.goto(route);
    await waitForHydration(page);
    const escalation = page.getByRole('button', { name: `Prepare ${tool} request` });
    await expect(escalation).toBeDisabled();
    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    await page.getByRole('button', { name: 'Run locally' }).click();
    await expect(page.getByText(localStatus)).toBeVisible({ timeout: 30_000 });
    await expect(escalation).toBeEnabled();
    await escalation.click();
    await expect(page.getByText(/No provider is configured.*no AI request was made/i)).toBeVisible();
  }
});
