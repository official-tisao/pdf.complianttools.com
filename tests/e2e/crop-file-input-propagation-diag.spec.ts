import { expect, test } from '@playwright/test';

/**
 * DIAGNOSTIC ONLY — pinpoints exact failure in file-selection pipeline.
 *
 * Checks: setInputFiles → selectFiles → ToolWorkspace.files → PdfPreview render.
 */
const FIXTURE = 'fixtures/pdfs/two-page.pdf';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test('diagnose exact file-selection propagation failure point', async ({ page }) => {
  const consoleMessages: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  // 1. Open the crop-pdf page.
  await page.goto('/crop-pdf');
  await expect(page.getByRole('heading', { level: 1, name: 'Crop PDF' })).toBeVisible({ timeout: 60_000 });

  // 2. Capture initial ToolWorkspace state.
  const initialState = await page.evaluate(() => {
    const body = document.body.innerText;
    const readySpan = document.querySelector('.toolbar span');
    const statusDiv = document.querySelector('.status');
    const fileDropLabel = document.querySelector('.drop-zone label span');
    const pdfPreview = document.querySelector('.pdf-preview');
    const grid = document.querySelector('.grid');
    const img = document.querySelector('.selected-page img');
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const firstInput = fileInputs[0] as HTMLInputElement;
    return {
      bodySnippet: body.slice(0, 300),
      readyText: readySpan?.textContent ?? null,
      statusText: statusDiv?.textContent ?? null,
      fileDropLabel: fileDropLabel?.textContent ?? null,
      pdfPreviewExists: !!pdfPreview,
      gridExists: !!grid,
      imgSrcLength: img ? img.src.length : 0,
      inputFilesLength: firstInput?.files?.length ?? 0,
      inputAccept: firstInput?.getAttribute('accept') ?? null,
    };
  });

  console.log('=== INITIAL STATE ===');
  console.log(JSON.stringify(initialState, null, 2));

  // 3. Set files via Playwright setInputFiles.
  const fileInput = page.locator('input[type="file"][accept*="pdf"]').first();
  await fileInput.setInputFiles(FIXTURE);

  // Playwright populates .files but often misses firing 'change';
  // Svelte 5 onchange needs the native event for selectFiles().
  await fileInput.evaluate((el) => {
    (el as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
  });

  // 4. Wait for Svelte 5 to process the change event.
  await page.waitForTimeout(500);

  // 5. Capture state immediately after setInputFiles.
  const afterInputState = await page.evaluate(() => {
    const body = document.body.innerText;
    const readySpan = document.querySelector('.toolbar span');
    const statusDiv = document.querySelector('.status');
    const pdfPreview = document.querySelector('.pdf-preview');
    const grid = document.querySelector('.grid');
    const img = document.querySelector('.selected-page img');
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const firstInput = fileInputs[0] as HTMLInputElement;
    return {
      bodySnippet: body.slice(0, 300),
      readyText: readySpan?.textContent ?? null,
      statusText: statusDiv?.textContent ?? null,
      pdfPreviewExists: !!pdfPreview,
      gridExists: !!grid,
      imgSrcLength: img ? img.src.length : 0,
      inputFilesLength: firstInput?.files?.length ?? 0,
    };
  });

  console.log('=== STATE AFTER setInputFiles (500ms) ===');
  console.log(JSON.stringify(afterInputState, null, 2));

  // 6. Wait longer for any reactive updates.
  await page.waitForTimeout(2000);

  // 7. Capture final state.
  const finalState = await page.evaluate(() => {
    const body = document.body.innerText;
    const readySpan = document.querySelector('.toolbar span');
    const statusDiv = document.querySelector('.status');
    const pdfPreview = document.querySelector('.pdf-preview');
    const grid = document.querySelector('.grid');
    const img = document.querySelector('.selected-page img');
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const firstInput = fileInputs[0] as HTMLInputElement;
    return {
      bodySnippet: body.slice(0, 300),
      readyText: readySpan?.textContent ?? null,
      statusText: statusDiv?.textContent ?? null,
      pdfPreviewExists: !!pdfPreview,
      gridExists: !!grid,
      imgSrcLength: img ? img.src.length : 0,
      inputFilesLength: firstInput?.files?.length ?? 0,
    };
  });

  console.log('=== FINAL STATE (2s) ===');
  console.log(JSON.stringify(finalState, null, 2));

  // 8. Report errors.
  console.log('=== CONSOLE MESSAGES ===');
  console.log(JSON.stringify(consoleMessages, null, 2));
  console.log('=== PAGE ERRORS ===');
  console.log(JSON.stringify(pageErrors, null, 2));

  await page.screenshot({ path: '/tmp/crop-file-input-propagation-diag.png', fullPage: true });
});