import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixture = resolve('fixtures/pdfs/one-page.pdf');

async function waitForHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => document.documentElement.dataset.appHydrated === 'true');
}

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

test('OCR downloads one verified model, recognizes locally, and exports text', async ({ page }) => {
  test.setTimeout(60_000);
  const modelRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/tessdata_fast@') && request.url().endsWith('/eng.traineddata')) {
      modelRequests.push(request.url());
    }
  });

  await page.goto('/ocr-pdf');
  await waitForHydration(page);
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Download model' })).toBeEnabled();

  await page.getByRole('button', { name: 'Download model' }).click();
  await expect(page.getByText(/verified and cached locally/i)).toBeVisible({ timeout: 30_000 });
  expect(modelRequests).toHaveLength(1);

  await page.locator('#output-mode').selectOption('plain-text-export');
  await page.getByRole('button', { name: 'Run OCR locally' }).click();
  await expect(page.getByText(/OCR complete for 1 page/i)).toBeVisible({ timeout: 30_000 });
  expect(modelRequests).toHaveLength(1);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download result' }).click(),
  ]);
  const outputPath = await download.path();
  expect(outputPath).not.toBeNull();
  const output = await readFile(outputPath!, 'utf8');
  expect(output).toMatch(/Phase|fixture/i);
});
