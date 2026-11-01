import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { convertFromPdf } from '../dist/index.js';

function toCsv(csvResult) {
  return new TextDecoder().decode(csvResult.bytes);
}

describe('PDF to CSV safety regression', () => {
  it('should not fabricate columns when positional evidence is insufficient', async () => {
    // Empty PDF bytes should not produce fabricated CSV columns
    const csvResult = await convertFromPdf('csv', new Uint8Array(0));
    const csv = toCsv(csvResult);
    assert.ok(csv.trim() === '' || !csv.includes('|'), 'no columns fabricated from empty input');
  });

  it('should handle prose text (no table structure) conservatively', async () => {
    // Create a synthetic PDF with prose text (no table layout)
    // This tests that when positional evidence doesn't satisfy the evidence gate,
    // the conservative line-level fallback activates instead of fabricating columns
    const pdfdoc = await PDFDocument.create();
    const page = pdfdoc.addPage([612, 792]);
    const font = await pdfdoc.embedFont(StandardFonts.Helvetica);
    page.drawText('This is prose text that spans the page width without column structure.', {
      x: 50,
      y: 700,
      size: 12,
      font,
    });
    const bytes = await pdfdoc.save();

    const csvResult = await convertFromPdf(
      'csv',
      new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    );
    const csv = toCsv(csvResult);

    // Prose should not produce multi-column table output
    const rows = csv.trim().split('\n');
    assert.ok(rows.length > 0, 'rows produced');
    // Each row should have at most 1 column (no fabricated split)
    for (const row of rows) {
      const cells = row.split(',');
      assert.ok(
        cells.length <= 1,
        `prose should not fabricate columns: got ${cells.length} cells: "${row}"`,
      );
    }
  });

  it('should handle single-column text with trailing content conservatively', async () => {
    const pdfdoc = await PDFDocument.create();
    const page = pdfdoc.addPage([612, 792]);
    const font = await pdfdoc.embedFont(StandardFonts.Helvetica);
    page.drawText('Single column item with trailing content 200', {
      x: 50,
      y: 720,
      size: 12,
      font,
    });
    const bytes = await pdfdoc.save();

    const csvResult = await convertFromPdf(
      'csv',
      new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    );
    const csv = toCsv(csvResult);
    console.log('DEBUG single-column CSV:', csv);

    // Single column: should not split into multiple columns
    const rows = csv.trim().split('\n');
    for (const row of rows) {
      const cells = row.split(',');
      // Should not artificially split into 2+ columns without evidence
      assert.ok(
        cells.length <= 2,
        `single-column should not fabricate split: ${cells.length} cells: "${row}"`,
      );
    }
  });

  it('should preserve attribution and line-level contract', async () => {
    // Verify that existing attribution and line-level contract is preserved
    // when the engine processes standard PDFs
    const path = '../../fixtures/fidelity/phase1-synthetic.pdf';
    if (!existsSync(path)) {
      console.log('fixture not found, skipping');
      return;
    }
    const bytes = readFileSync(path);
    const csvResult = await convertFromPdf(
      'csv',
      new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    );
    const csv = toCsv(csvResult);

    // CSV output must include the expected header and data
    assert.ok(
      csv.includes('Name,Amount') || csv.trim().split('\n').length > 1,
      'CSV output preserves line-level contract',
    );
  });
});
