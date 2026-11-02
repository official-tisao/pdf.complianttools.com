import { expect, test } from '@playwright/test';

/**
 * DIAGNOSTIC ONLY — not a permanent test.
 *
 * Captures browser console errors, failed network requests, and injects
 * temporary diagnostic logging into the crop-pdf page to determine why
 * pdf.js getDocument().promise never resolves.
 */
const FIXTURE = 'fixtures/pdfs/two-page.pdf';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test('diagnose pdf.js document loading', async ({ page }) => {
  const consoleMessages: Array<{ type: string; text: string }> = [];
  const failedRequests: Array<{ url: string; failure?: string }> = [];

  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleMessages.push({ type: 'pageerror', text: err.message });
  });
  page.on('requestfailed', (req) => {
    failedRequests.push({
      url: req.url(),
      failure: req.failure()?.errorText,
    });
  });

  // 1. Open the crop-pdf page.
  await page.goto('/crop-pdf');
  await expect(page.getByRole('heading', { level: 1, name: 'Crop PDF' })).toBeVisible({ timeout: 60_000 });

  // 2. Upload the fixture.
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles(FIXTURE);

  // Wait up to 90s for either the preview to appear OR for a visible error.
  const result = await Promise.race([
    page
      .locator('.pdf-preview')
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => 'PREVIEW_VISIBLE')
      .catch(() => null),
    page
      .locator('.preview-error')
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => 'PREVIEW_ERROR')
      .catch(() => null),
    page
      .locator('.empty')
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => 'EMPTY_VISIBLE')
      .catch(() => null),
  ]);

  // 3. Capture DOM state at timeout.
  // Use the race result to determine state.
  const domState = await page.evaluate(() => {
    const body = document.body.innerText;
    const preview = document.querySelector('.pdf-preview');
    const error = document.querySelector('.preview-error');
    const empty = document.querySelector('.empty');
    const img = document.querySelector('.selected-page img');
    const grid = document.querySelector('.grid');
    return {
      bodySnippet: body.slice(0, 500),
      previewExists: !!preview,
      errorText: error ? error.textContent : null,
      emptyText: empty ? empty.textContent : null,
      imgSrcLength: img ? img.src.length : 0,
      gridExists: !!grid,
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });

  // 4. Report.
  console.log('=== DIAGNOSTIC RESULT ===');
  console.log('Race result:', result);
  console.log('DOM state:', JSON.stringify(domState, null, 2));
  console.log('Console messages count:', consoleMessages.length);
  console.log('Failed requests count:', failedRequests.length);

  // 5. Screenshot.
  await page.screenshot({ path: '/tmp/crop-diag.png', fullPage: true });

  // 6. Assertion: we expect to know what happened.
  expect(result).not.toBeNull();
  // 7. If preview never appeared, dump the full diagnostic data.
  if (result === 'timeout') {
    console.log('FULL CONSOLE:', JSON.stringify(consoleMessages, null, 2));
    console.log('FULL FAILED REQUESTS:', JSON.stringify(failedRequests, null, 2));
  }
});