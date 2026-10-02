import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const markdownFixture = resolve('fixtures/conversion/markdown-golden.md');
const pdfFixture = resolve('fixtures/pdfs/one-page.pdf');

async function expectRenderedPdfPreview(page: import('@playwright/test').Page) {
  const grid = page.getByRole('grid', { name: 'PDF pages' });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await expect(grid.getByRole('button', { name: 'Page 1' })).toBeVisible();
  await expect(grid.locator('img')).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(
      () =>
        grid
          .locator('img')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
          ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.getByRole('img', { name: /page 1/i })).toBeVisible();
}

test('to-PDF ConversionTool previews the generated PDF after Markdown is attached', async ({
  page,
}) => {
  await page.goto('/text-pdf');
  await page.locator('input[type="file"]').setInputFiles(markdownFixture);

  await expectRenderedPdfPreview(page);
});

test('from-PDF ConversionTool previews the attached source PDF', async ({ page }) => {
  await page.goto('/pdf-to-image');
  await page.locator('input[type="file"]').setInputFiles(pdfFixture);

  await expectRenderedPdfPreview(page);
});
