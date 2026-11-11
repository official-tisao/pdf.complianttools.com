import { expect, test } from '@playwright/test';

/**
 * DIAGNOSTIC ONLY — not a permanent test.
 *
 * Checks whether the file input exists, whether setInputFiles works,
 * and whether the change event propagates to ToolWorkspace.selectFiles.
 */
const FIXTURE = 'fixtures/pdfs/two-page.pdf';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test('diagnose file input and selection propagation', async ({ page }) => {
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
  await expect(page.getByRole('heading', { level: 1, name: 'Crop PDF' })).toBeVisible({
    timeout: 60_000,
  });

  // 2. Count file inputs and check their attributes.
  const inputInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.map((input, i) => ({
      index: i,
      accept: (input as HTMLInputElement).accept,
      multiple: (input as HTMLInputElement).multiple,
      disabled: (input as HTMLInputElement).disabled,
      parentTag: input.parentElement?.tagName,
      parentLabel: input.closest('label') ? 'yes' : 'no',
    }));
  });

  console.log('=== FILE INPUTS FOUND ===');
  console.log(JSON.stringify(inputInfo, null, 2));

  // 3. Try to set files on the first input.
  const fileInput = page.locator('input[type="file"][accept*="pdf"]').first();
  const inputExists = await fileInput.count();
  console.log('File input count:', inputExists);

  if (inputExists > 0) {
    await fileInput.setInputFiles(FIXTURE);

    // Explicitly fire the change event — Playwright's setInputFiles
    // populates .files but does not dispatch 'change'; Svelte 5
    // onchange={selectFiles} requires the native event.
    await fileInput.evaluate((el) => {
      (el as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 4. Wait briefly for Svelte to process the change event.
    await page.waitForTimeout(500);

    // 5. Check the file input's files property.
    const fileCount = await fileInput.evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
    console.log('File input files length after setInputFiles:', fileCount);

    // 6. Check the DOM state.
    const domState = await page.evaluate(() => {
      const body = document.body.innerText;
      const preview = document.querySelector('.pdf-preview');
      const error = document.querySelector('.preview-error');
      const empty = document.querySelector('.empty');
      const readyText = document.querySelector('.toolbar span');
      const grid = document.querySelector('.grid');
      const img = document.querySelector('.selected-page img');
      return {
        bodySnippet: body.slice(0, 300),
        previewExists: !!preview,
        errorText: error ? error.textContent : null,
        emptyText: empty ? empty.textContent : null,
        readyText: readyText ? readyText.textContent : null,
        gridExists: !!grid,
        imgSrcLength: img ? img.src.length : 0,
        canvasCount: document.querySelectorAll('canvas').length,
      };
    });

    console.log('=== DOM STATE AFTER setInputFiles ===');
    console.log(JSON.stringify(domState, null, 2));

    // 7. Wait longer to see if anything changes.
    await page.waitForTimeout(2000);
    const domState2 = await page.evaluate(() => {
      const preview = document.querySelector('.pdf-preview');
      const readyText = document.querySelector('.toolbar span');
      return {
        previewExists: !!preview,
        readyText: readyText ? readyText.textContent : null,
        bodySnippet: document.body.innerText.slice(0, 300),
      };
    });
    console.log('=== DOM STATE AFTER 2s ===');
    console.log(JSON.stringify(domState2, null, 2));
  } else {
    console.log('ERROR: No file input found!');
  }

  // 8. Report console errors.
  console.log('=== CONSOLE MESSAGES ===');
  console.log(JSON.stringify(consoleMessages, null, 2));
  console.log('=== PAGE ERRORS ===');
  console.log(JSON.stringify(pageErrors, null, 2));

  await page.screenshot({ path: '/tmp/crop-file-input-diag.png', fullPage: true });
});
