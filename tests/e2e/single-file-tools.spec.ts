import { expect, test, type Page } from '@playwright/test';

import { openHydrated } from './helpers';

/**
 * STCC: a route whose operation processes one document accepts one document.
 *
 * Bates numbering stamps a single PDF — its engine op takes one buffer, not a
 * list — so the picker accepted three files, showed three, and stamped only
 * the first. The two documents the user believed had been numbered were never
 * read, and nothing said so. The count in the status line was the only clue,
 * and it read as a feature.
 *
 * The fix is a `singleFile` opt-in on the shared workspace rather than a
 * change to the shared dropzone, because the routes that genuinely merge
 * files need multiple selection. This spec covers both halves: the single-
 * file route refuses a multiple selection and says why, and the multi-file
 * routes are untouched.
 */

/** A minimal PDF header. Enough for the picker; the preview may reject it. */
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

/** The drop zone's file input. */
const input = (page: Page) => page.locator('input[type="file"]');

/**
 * Drops several files onto the drop zone.
 *
 * A drop never reaches the file input — the browser hands the drop zone its
 * own `FileList` — so this exercises the drag-and-drop path that the picker
 * cannot reach, and the one that previously truncated to the first file
 * without a word.
 */
const dropFiles = async (page: Page, names: string[]) => {
  await page.evaluate((fileNames) => {
    const transfer = new DataTransfer();
    for (const name of fileNames) {
      transfer.items.add(
        new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], name, {
          type: 'application/pdf',
        }),
      );
    }
    const zone = document.querySelector('.drop-zone');
    if (!zone) throw new Error('no drop zone on the page');
    zone.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, names);
};

test.describe('a single-file tool accepts exactly one document', () => {
  test('the picker does not offer a multiple selection', async ({ page }) => {
    await openHydrated(page, '/bates-numbering');
    // `multiple` is an attribute, not a property: the served HTML must not
    // carry it, because that is what the browser's own file dialog honours.
    await expect(input(page)).not.toHaveAttribute('multiple', /.*/u);
  });

  test('choosing a file reports one file, not a count of files', async ({ page }) => {
    await openHydrated(page, '/bates-numbering');
    await input(page).setInputFiles({
      name: 'one.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_BYTES),
    });

    // The singular wording, and never the plural: the route holds one
    // document, so "2 files ready locally." would be a false statement about
    // its own state.
    await expect(page.locator('.toolbar span')).toHaveText('1 file ready locally.');
    await expect(page.locator('.toolbar span')).not.toContainText('files ready locally');
  });

  test('choosing a second file replaces the first rather than adding to it', async ({ page }) => {
    await openHydrated(page, '/bates-numbering');
    const picker = input(page);
    await picker.setInputFiles({
      name: 'first.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_BYTES),
    });
    await expect(page.locator('.toolbar span')).toHaveText('1 file ready locally.');

    await picker.setInputFiles({
      name: 'second.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_BYTES),
    });

    // One file still, and the label still says one — an append would show
    // "2 files ready locally." here.
    await expect(page.locator('.toolbar span')).toHaveText('1 file ready locally.');
  });

  test('dropping several files is refused with an explanation', async ({ page }) => {
    await openHydrated(page, '/bates-numbering');
    await dropFiles(page, ['one.pdf', 'two.pdf', 'three.pdf']);

    // The refusal is stated, not silent: a drop that quietly does nothing is
    // indistinguishable from a broken page.
    await expect(page.getByRole('alert')).toHaveText(
      'Only one PDF file can be processed at a time.',
    );
    // And nothing was loaded from the refused drop.
    await expect(page.locator('.toolbar span')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Add Bates numbers' })).toBeDisabled();
  });

  test('a refused drop does not clear a file that was already loaded', async ({ page }) => {
    await openHydrated(page, '/bates-numbering');
    await input(page).setInputFiles({
      name: 'kept.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(PDF_BYTES),
    });
    await expect(page.locator('.toolbar span')).toHaveText('1 file ready locally.');

    await dropFiles(page, ['one.pdf', 'two.pdf']);

    // The refusal is about the drop, not about the workspace: refusing to
    // accept more files is not a request to unload the one already there.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.toolbar span')).toHaveText('1 file ready locally.');
  });

  test('the refusal is announced assertively, not politely', async ({ page }) => {
    await openHydrated(page, '/bates-numbering');
    await dropFiles(page, ['one.pdf', 'two.pdf']);

    // A refusal is not progress. The polite status region would let a screen
    // reader user miss it, so the error sits in an alert instead. `role="alert"`
    // is implicitly assertive, so the assertion is on the role itself: an
    // `aria-live` attribute check would pass on an element that carries none.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.status')).not.toContainText('Only one PDF file');
  });

  test('the refusal is translated on the Arabic route', async ({ page }) => {
    await openHydrated(page, '/ar/bates-numbering');
    await dropFiles(page, ['one.pdf', 'two.pdf']);

    // A catalogue key with no Arabic entry falls back to the English source,
    // which renders as an untranslated string on an RTL page. The refusal is
    // the one piece of copy a user who cannot read English must still be
    // able to act on, so it is asserted in Arabic here.
    await expect(page.getByRole('alert')).toHaveText('يمكن معالجة ملف PDF واحد فقط في كل مرة.');
  });
});

test.describe('a multi-file tool is unaffected', () => {
  test('/merge still accepts several files at once', async ({ page }) => {
    await openHydrated(page, '/merge');
    // Merging is the operation that genuinely needs several documents, so
    // the single-file rule must not have reached it.
    await expect(input(page)).toHaveAttribute('multiple', /.*/u);
  });

  test('/merge still counts its files in the plural', async ({ page }) => {
    await openHydrated(page, '/merge');
    await input(page).setInputFiles([
      { name: 'one.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF_BYTES) },
      { name: 'two.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF_BYTES) },
    ]);
    await expect(page.locator('.toolbar span')).toHaveText('2 files ready locally.');
  });
});
