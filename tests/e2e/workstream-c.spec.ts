import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const signedFixture = resolve('fixtures/pdfs/signed-one-page.pdf');
const trustAnchor = resolve('fixtures/pdfs/signed-one-page.trust.der');

test('signature verification accepts an explicit DER trust anchor', async ({ page }) => {
  await page.goto('/verify-signature');
  await page.waitForFunction(() => document.documentElement.dataset.appHydrated === 'true');

  const inputs = page.locator('input[type="file"]');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).setInputFiles(signedFixture);
  await inputs.nth(1).setInputFiles(trustAnchor);
  await expect(page.getByText(/selected \(1 certificate\)/i)).toBeVisible();

  await page.getByRole('button', { name: 'Run locally' }).click();
  await expect(page.getByText(/^verified:/i)).toBeVisible({ timeout: 30_000 });
});
